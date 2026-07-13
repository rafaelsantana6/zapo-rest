/**
 * VoIP control WebSocket — signaling plane (softphone style).
 *
 * URL: ws(s)://host/v1/voip?apiKey=...&instance=optional
 *
 * Protocol: JSON text frames (native WS). Event stream is SSE at GET /v1/events.
 *
 * Client → server:
 * { op: "instance:attach", id, instance }
 * { op: "call:start", id, phone, contactName? }
 * { op: "call:accept", id, callId }
 * { op: "call:reject", id, callId }
 * { op: "call:end", id, callId }
 * { op: "call:mute", id, callId, muted }
 * { op: "ping", id }
 *
 * Server → client:
 * { op: "ready", instance, role }
 * { op: "ack", id, ok: true, data? } | { op: "ack", id, ok: false, code, message }
 * { op: "calls:snapshot", calls: SerializedCall[] }
 * { op: "call:offer" | "call:ringing" | "call:accepted" | "call:state" | "call:ended", call }
 * { op: "device:status", status, meJid? }
 * { op: "pong", id, ts }
 *
 * Audio PCM stays on GET /v1/instances/:name/calls/:callId/stream (separate channel).
 *
 * IMPORTANT (@fastify/websocket): attach `socket.on('message')` **synchronously** in the
 * route handler. Any `await` before that silently drops client frames.
 */

import type { FastifyPluginAsync } from 'fastify'
import type { WebSocket } from 'ws'
import { type AuthDeps, resolveActor } from '~/auth/plugin'
import { type Actor, canAccessInstance, isAdmin } from '~/auth/types'
import type { Env } from '~/config/env'
import { type RealtimeEvent, realtimeBus } from '~/events/bus'
import type { InstanceManager } from '~/instances/manager'
import type { InstanceRepo } from '~/instances/repo'
import { asVoipClient } from '~/instances/wa-client'
import { getLogger } from '~/lib/logger'
import { toRecipientJid } from '~/lib/phone'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { CacheClient } from '~/redis/client'
import { resolveLiveCall, type SerializedCall, serializeCallInfo } from '~/voip/call-serialize'
import type { CallRecordingManager } from '~/voip/recording-manager'

export type VoipWsDeps = {
  env: Env
  instanceRepo: InstanceRepo
  manager: InstanceManager
  callRecording?: CallRecordingManager
  cache?: CacheClient
}

type ClientMsg = {
  op?: string
  id?: string
  instance?: string
  phone?: string
  callId?: string
  muted?: boolean
  contactName?: string
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)
    }),
  ])
}

export const voipWsRoutes: FastifyPluginAsync<VoipWsDeps> = async (app, deps) => {
  const { cache } = deps
  const log = getLogger({ component: 'voip-ws' })
  const authDeps: AuthDeps = { env: deps.env, instanceRepo: deps.instanceRepo }
  const { manager, callRecording } = deps

  app.get(
    '/v1/voip',
    {
      websocket: true,
      schema: {
        tags: ['Calls'],
        summary: 'VoIP control WebSocket (signaling)',
        description:
          'Control plane for softphone (softphone style). Auth via `?apiKey=`. ' +
          'Attach an instance, then receive `call:offer` / `call:state` / `call:ended` push events. ' +
          'PCM audio remains on `.../calls/:callId/stream`.',
      },
    },
    // MUST be sync so on('message') is registered before any await (fastify/websocket docs).
    // biome-ignore lint/suspicious/noExplicitAny: fastify websocket
    (socket: WebSocket, request: any) => {
      const q = request.query as { apiKey?: string; instance?: string }
      const apiKey =
        q.apiKey || (typeof request.headers['x-api-key'] === 'string' ? request.headers['x-api-key'] : null)

      if (!apiKey) {
        socket.send(JSON.stringify({ op: 'error', code: 'UNAUTHORIZED', message: 'Missing apiKey' }))
        socket.close()
        return
      }

      let actor: Actor | null = null
      let attached: string | null = null
      let unsub: (() => void) | null = null
      let closed = false

      const send = (payload: unknown) => {
        if (socket.readyState === socket.OPEN) {
          try {
            socket.send(JSON.stringify(payload))
          } catch {
            /* closed */
          }
        }
      }

      const ackOk = (id: string | undefined, data?: unknown) => {
        if (!id) return
        send({ op: 'ack', id, ok: true, data })
      }
      const ackErr = (id: string | undefined, code: string, message: string) => {
        if (!id) return
        send({ op: 'ack', id, ok: false, code, message })
      }

      const snapshotCalls = (instanceName: string): SerializedCall[] => {
        try {
          const client = asVoipClient(manager.getClient(instanceName))
          return client.voip.getCalls().map((c) => serializeCallInfo(c))
        } catch {
          return []
        }
      }

      const deviceStatus = async (instanceName: string) => {
        try {
          const inst = await manager.get(instanceName)
          return { status: inst.status, meJid: inst.meJid }
        } catch {
          return { status: 'unknown', meJid: null as string | null }
        }
      }

      const bindBus = (instanceName: string) => {
        unsub?.()
        unsub = realtimeBus.onInstance(instanceName, (payload: RealtimeEvent) => {
          if (payload.event === 'call.incoming') {
            send({ op: 'call:offer', call: payload.data, eventId: payload.eventId })
            return
          }
          if (payload.event === 'call.state') {
            // biome-ignore lint/suspicious/noExplicitAny: call payload
            const call = payload.data as any
            const state = String(call?.state ?? '')
            if (state === 'ringing' || call?.isRinging) {
              send({ op: 'call:ringing', call, eventId: payload.eventId })
            } else if (state === 'connecting' || state === 'active' || call?.isActive) {
              send({ op: 'call:accepted', call, eventId: payload.eventId })
            }
            send({ op: 'call:state', call, eventId: payload.eventId })
            return
          }
          if (payload.event === 'call.ended') {
            send({ op: 'call:ended', call: payload.data, eventId: payload.eventId })
            return
          }
          if (payload.event === 'instance.connection' || payload.event === 'instance.paired') {
            // biome-ignore lint/suspicious/noExplicitAny: connection payload
            const d = payload.data as any
            send({
              op: 'device:status',
              status: (d?.status ?? d?.registered) ? 'open' : 'close',
              meJid: d?.meJid ?? null,
              eventId: payload.eventId,
            })
          }
        })
      }

      const doAttach = async (instanceName: string, role: Actor['role']) => {
        if (!actor) throw new Error('UNAUTHORIZED')
        if (!canAccessInstance(actor, instanceName) && !isAdmin(actor)) {
          throw new Error('FORBIDDEN')
        }
        if (actor.role === 'instance' && actor.instanceName !== instanceName) {
          throw new Error('FORBIDDEN')
        }
        await manager.get(instanceName)
        attached = instanceName
        bindBus(instanceName)
        const calls = snapshotCalls(instanceName)
        const device = await deviceStatus(instanceName)
        send({ op: 'ready', instance: instanceName, role })
        send({ op: 'device:status', ...device })
        send({ op: 'calls:snapshot', calls })
      }

      // Auth + optional auto-attach. Message handlers await this so early frames are not dropped.
      const boot = (async () => {
        const resolved = await resolveActor(authDeps, apiKey)
        if (!resolved) {
          send({ op: 'error', code: 'UNAUTHORIZED', message: 'Invalid apiKey' })
          socket.close()
          return
        }
        actor = resolved

        const preferred: string | null =
          actor.role === 'instance'
            ? actor.instanceName
            : q.instance && canAccessInstance(actor, q.instance)
              ? q.instance
              : null

        if (preferred && !canAccessInstance(actor, preferred)) {
          send({ op: 'error', code: 'FORBIDDEN', message: 'Forbidden instance' })
          socket.close()
          return
        }

        if (preferred) {
          try {
            await doAttach(preferred, actor.role)
          } catch (err) {
            send({
              op: 'error',
              code: 'ATTACH_FAILED',
              message: err instanceof Error ? err.message : 'attach failed',
            })
          }
        } else {
          send({ op: 'ready', instance: null, role: actor.role })
        }
      })()

      // CRITICAL: register before any await on this stack (boot is fire-and-forget).
      socket.on('message', (raw) => {
        void (async () => {
          let msg: ClientMsg
          try {
            msg = JSON.parse(String(raw)) as ClientMsg
          } catch {
            return
          }
          const op = msg.op
          const id = msg.id

          log.info({ op, id, attached }, 'voip-ws ← client')

          try {
            await boot
            if (closed || !actor) return

            if (op === 'ping') {
              send({ op: 'pong', id, ts: Date.now() })
              return
            }

            if (op === 'instance:attach') {
              const inst = msg.instance
              if (!inst) {
                ackErr(id, 'INVALID_PAYLOAD', 'instance required')
                return
              }
              await doAttach(inst, actor.role)
              ackOk(id, { instance: inst })
              return
            }

            if (!attached) {
              ackErr(id, 'NO_INSTANCE', 'attach an instance first')
              return
            }

            if (op === 'calls:list') {
              ackOk(id, { calls: snapshotCalls(attached) })
              return
            }

            if (op === 'call:start') {
              const phone = msg.phone?.trim()
              if (!phone || phone.length < 3) {
                ackErr(id, 'INVALID_PAYLOAD', 'phone required')
                return
              }
              log.info({ phone, instance: attached, id }, 'call:start — received')
              const client = asVoipClient(manager.requireRegisteredClient(attached))

              // Live calls fill the single concurrent slot — surface clearly instead of hanging.
              const live = snapshotCalls(attached).filter((c) => !c.isEnded)
              if (live.length > 0) {
                const busy = live[0]
                ackErr(
                  id,
                  'CALL_BUSY',
                  `já existe chamada ativa (${busy?.callId ?? '?'} state=${busy?.state ?? '?'}); encerre/recuse antes de discar`,
                )
                return
              }

              let peerJid: string
              try {
                peerJid = await withTimeout(resolveRecipientJid(client, phone, cache), 5_000, 'resolveRecipientJid')
              } catch (err) {
                peerJid = toRecipientJid(phone)
                log.warn({ err, phone, peerJid, instance: attached }, 'call:start — resolve timed out, using local JID')
              }

              log.info({ phone, peerJid, instance: attached }, 'call:start — placing offer')
              const callId = await withTimeout(client.voip.startCall({ peerJid }), 15_000, 'startCall')

              try {
                client.voip.setExternalAudioMode(callId, true)
              } catch (err) {
                log.warn({ err, callId }, 'setExternalAudioMode after start failed')
              }
              if (callRecording) {
                await callRecording.onCallStarted(attached, {
                  callId,
                  peerJid,
                  direction: 'outbound',
                  mediaType: 'audio',
                  state: 'calling',
                })
              }
              const call = client.voip.getCall(callId)
              const serialized = call
                ? serializeCallInfo(call, { mappedPn: peerJid })
                : {
                    callId,
                    peerJid,
                    peerJidRaw: peerJid,
                    peerLid: null,
                    callerPn: null,
                    direction: 'outgoing' as const,
                    state: 'ringing',
                    isActive: false,
                    isRinging: true,
                    isEnded: false,
                    canAccept: false,
                    acceptBlocked: false,
                    mediaType: 'audio',
                    createdAt: null,
                    audioMuted: undefined,
                    durationSecs: null,
                    endReason: null,
                  }
              ackOk(id, { callId, peerJid: serialized.peerJid ?? peerJid, call: serialized })
              send({ op: 'call:ringing', call: serialized })
              log.info({ callId, peerJid }, 'call:start — acked softphone')
              return
            }

            if (op === 'call:accept') {
              log.info({ callId: msg.callId, instance: attached, id }, 'call:accept — received')
              const callId = msg.callId
              if (!callId) {
                ackErr(id, 'INVALID_PAYLOAD', 'callId required')
                return
              }
              const client = asVoipClient(manager.requireRegisteredClient(attached))
              const resolved = resolveLiveCall(client, callId)
              if (!resolved) {
                const live = snapshotCalls(attached)
                log.warn(
                  { callId, liveIds: live.map((c) => c.callId), liveStates: live.map((c) => c.state) },
                  'call:accept — call not found',
                )
                ackErr(id, 'CALL_NOT_FOUND', 'call not found')
                return
              }
              const snap = serializeCallInfo(resolved)
              if (!resolved.canAccept) {
                log.warn(
                  {
                    callId: resolved.callId,
                    state: snap.state,
                    direction: snap.direction,
                    canAccept: snap.canAccept,
                    acceptBlocked: snap.acceptBlocked,
                  },
                  'call:accept — not acceptable',
                )
                ackErr(
                  id,
                  'CALL_NOT_ACCEPTABLE',
                  `cannot accept in state ${snap.state ?? '?'} (direction=${snap.direction}, acceptBlocked=${snap.acceptBlocked})`,
                )
                return
              }
              if (!resolved.encryptionKey) {
                log.error({ callId: resolved.callId }, 'call:accept — missing encryptionKey')
                ackErr(
                  id,
                  'CALL_NO_KEY',
                  'call encryption key missing (offer decrypt failed) — cannot complete accept; hang up and retry',
                )
                return
              }
              try {
                client.voip.setExternalAudioMode(resolved.callId, true)
              } catch (err) {
                log.warn({ err, callId: resolved.callId }, 'setExternalAudioMode failed')
              }
              log.info({ callId: resolved.callId, peer: snap.peerJid }, 'call:accept — kicking off acceptCall')
              const acceptCallId = resolved.callId
              const optimistic = { ...snap, state: 'connecting', canAccept: false, isRinging: false }
              ackOk(id, { callId: acceptCallId, call: optimistic })
              send({ op: 'call:accepted', call: optimistic })
              log.info({ callId: acceptCallId, state: 'connecting' }, 'call:accept — acked softphone')
              setImmediate(() => {
                try {
                  const acceptP = client.voip.acceptCall(acceptCallId)
                  void acceptP
                    .then(() => {
                      log.info({ callId: acceptCallId }, 'acceptCall finished (relays connected)')
                      const after = client.voip.getCall(acceptCallId)
                      if (after) send({ op: 'call:state', call: serializeCallInfo(after) })
                    })
                    .catch((err: unknown) => {
                      log.error({ err, callId: acceptCallId }, 'acceptCall background failed')
                    })
                } catch (err) {
                  log.error({ err, callId: acceptCallId }, 'acceptCall threw synchronously')
                }
              })
              return
            }

            if (op === 'call:reject') {
              const callId = msg.callId
              if (!callId) {
                ackErr(id, 'INVALID_PAYLOAD', 'callId required')
                return
              }
              const client = asVoipClient(manager.requireRegisteredClient(attached))
              const resolved = resolveLiveCall(client, callId)
              if (!resolved) {
                ackErr(id, 'CALL_NOT_FOUND', 'call not found')
                return
              }
              await client.voip.rejectCall(resolved.callId)
              ackOk(id, { callId: resolved.callId })
              send({
                op: 'call:ended',
                call: { ...serializeCallInfo(resolved), state: 'ended', isEnded: true },
              })
              return
            }

            if (op === 'call:end') {
              const callId = msg.callId
              if (!callId) {
                ackErr(id, 'INVALID_PAYLOAD', 'callId required')
                return
              }
              const client = asVoipClient(manager.requireRegisteredClient(attached))
              const resolved = resolveLiveCall(client, callId)
              if (!resolved) {
                ackOk(id, { callId })
                return
              }
              await client.voip.endCall(resolved.callId)
              ackOk(id, { callId: resolved.callId })
              return
            }

            if (op === 'call:mute') {
              const callId = msg.callId
              if (!callId || typeof msg.muted !== 'boolean') {
                ackErr(id, 'INVALID_PAYLOAD', 'callId + muted required')
                return
              }
              const client = asVoipClient(manager.requireRegisteredClient(attached))
              const resolved = resolveLiveCall(client, callId)
              if (!resolved) {
                ackErr(id, 'CALL_NOT_FOUND', 'call not found')
                return
              }
              client.voip.setMute(resolved.callId, msg.muted)
              ackOk(id, { callId: resolved.callId, muted: msg.muted })
              return
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'internal error'
            log.warn({ err, op, instance: attached }, 'voip-ws command failed')
            if (message === 'FORBIDDEN') {
              ackErr(id, 'FORBIDDEN', 'forbidden')
            } else {
              ackErr(id, 'CALL_FAILED', message)
            }
          }
        })()
      })

      socket.on('close', () => {
        closed = true
        unsub?.()
      })
      socket.on('error', () => {
        closed = true
        unsub?.()
      })

      const ping = setInterval(() => {
        if (socket.readyState === socket.OPEN) {
          try {
            socket.ping()
          } catch {
            /* */
          }
        }
      }, 30_000)
      ping.unref?.()
      socket.on('close', () => clearInterval(ping))

      // Kick boot (auth + auto-attach) without blocking message registration.
      void boot.catch((err) => {
        log.error({ err }, 'voip-ws boot failed')
        try {
          socket.close()
        } catch {
          /* */
        }
      })
    },
  )
}
