import { attachRemoteMedia } from '~/voip/remote-media'
import { clientMediaMode } from '~/voip/media-mode'
/**
 * VoIP control WebSocket — signaling plane (softphone style).
 *
 * URL: ws(s)://host/v1/voip?apiKey=...&instance=optional
 *
 * Protocol: JSON text frames (native WS). Event stream is SSE at GET /v1/events.
 *
 * Client → server:
 * { op: "instance:attach", id, instance }
 * { op: "call:start", id, phone, video?, contactName? }
 * { op: "call:accept", id, callId }
 * { op: "call:reject", id, callId }
 * { op: "call:end", id, callId }
 * { op: "call:mute", id, callId, muted }
 * { op: "call:hand", id, callId, raised }
 * { op: "call:reaction", id, callId, reaction }
 * { op: "call:leave" | "call:join", id, callId }           (group calls)
 * { op: "call:mute_participant", id, callId, participant }  (group calls)
 * { op: "call:video_upgrade", id, callId }                   → ack data.result
 * { op: "call:video_upgrade_accept" | "call:video_upgrade_reject" | "call:video_upgrade_cancel", id, callId }
 * { op: "call:video", id, callId, enabled }                  (group camera)
 * { op: "call:screen_share", id, callId, sharing }
 * { op: "ping", id }
 *
 * Server → client:
 * { op: "ready", instance, role }
 * { op: "ack", id, ok: true, data? } | { op: "ack", id, ok: false, code, message }
 * { op: "calls:snapshot", calls: SerializedCall[] }
 * { op: "call:offer" | "call:ringing" | "call:accepted" | "call:state" | "call:ended", call }
 * { op: "call:peer_mute", call, muted } | { op: "call:hand_raise", call, participantJid, raised }
 * { op: "call:reaction", call, reaction }
 * { op: "call:participants_changed" | "call:mute_requested" | "call:participant_media", call, ... }
 * { op: "call:video_state" | "call:video_upgraded" | "call:screen_share_changed", call, ... }
 * { op: "device:status", status, meJid? }
 * { op: "pong", id, ts }
 *
 * Audio PCM stays on GET /v1/calls/:callId/stream; H.264 video on GET /v1/calls/:callId/video
 * (separate binary channels; instance key only).
 *
 * IMPORTANT (@fastify/websocket): attach `socket.on('message')` **synchronously** in the
 * route handler. Any `await` before that silently drops client frames.
 */

import type { FastifyPluginAsync } from 'fastify'
import type { WebSocket } from 'ws'
import { type AuthDeps, resolveActor } from '~/auth/plugin'
import type { Actor } from '~/auth/types'
import type { Env } from '~/config/env'
import { type RealtimeEvent, realtimeBus } from '~/events/bus'
import type { InstanceManager } from '~/instances/manager'
import type { InstanceRepo } from '~/instances/repo'
import { asVoipClient } from '~/instances/wa-client'
import { getLogger } from '~/lib/logger'
import { toRecipientJid } from '~/lib/phone'
import { resolveRecipientJid } from '~/lib/phone-resolve'
import type { CacheClient } from '~/redis/client'
import { sendCallReaction, setCallHand } from '~/voip/call-interactions'
import {
  answerVideoUpgrade,
  requestVideoUpgrade,
  setGroupVideo,
  setScreenShare,
  type UpgradeAnswer,
} from '~/voip/call-video-controls'
import { joinGroupCall, leaveGroupCall, requestParticipantMute } from '~/voip/group-call'
import { resolveLiveCall, type SerializedCall, serializeCallInfo } from '~/voip/call-serialize'
import type { CallRecordingManager } from '~/voip/recording-manager'
import { isNotOnWhatsAppError } from '~/voip/start-call-error'

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
  raised?: boolean
  reaction?: string
  participant?: string
  enabled?: boolean
  sharing?: boolean
  video?: boolean
  event?: string
  contactName?: string
}

/** Peer-side interaction events forwarded as-is (`call.peer_mute` → `call:peer_mute`). */
const INTERACTION_EVENTS: Record<string, string> = {
  'call.peer_mute': 'call:peer_mute',
  'call.hand_raise': 'call:hand_raise',
  'call.reaction': 'call:reaction',
  'call.error': 'call:error',
  'call.audio_finished': 'call:audio_finished',
  'call.participants_changed': 'call:participants_changed',
  'call.mute_requested': 'call:mute_requested',
  'call.participant_media': 'call:participant_media',
  'call.video_state': 'call:video_state',
  'call.video_upgraded': 'call:video_upgraded',
  // Not `call:screen_share`: that is the client's command
  'call.screen_share': 'call:screen_share_changed',
}

/** `call:video_upgrade_accept` → `accept`, … */
const UPGRADE_ANSWER_OPS: Record<string, UpgradeAnswer> = {
  'call:video_upgrade_accept': 'accept',
  'call:video_upgrade_reject': 'reject',
  'call:video_upgrade_cancel': 'cancel',
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
          'Local PCM audio stays on `.../calls/:callId/stream`. Remote mode carries private `call:media` plans ' +
          '(message = encodeCallMediaMessage string) and `call:media_event` host reports (event = encodeCallMediaEvent string). ' +
          'Late attach/resync sends a snapshot; plans never enter SSE, webhooks or logs. Ready includes mediaMode and mlowRed.',
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
      let privateMedia: ReturnType<typeof attachRemoteMedia> | null = null
      let privateClient: object | null = null

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
          return client.voip.getCalls().map((c) => serializeCallInfo(c, { mediaMode: clientMediaMode(client) }))
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

      const bindPrivateMedia = (instanceName: string) => {
        if (closed) return deps.env.VOIP_MEDIA_MODE
        try {
          const client = asVoipClient(manager.getClient(instanceName))
          if (client !== privateClient) {
            privateMedia?.close()
            privateMedia = clientMediaMode(client) === 'remote' ? attachRemoteMedia(client, socket) : null
            privateClient = client
          }
          return clientMediaMode(client)
        } catch {
          return deps.env.VOIP_MEDIA_MODE
        }
      }

      const snapshotPrivateMedia = () => privateMedia?.snapshotAll()

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
          const interactionOp = INTERACTION_EVENTS[payload.event]
          if (interactionOp) {
            send({ ...(payload.data as object), op: interactionOp, eventId: payload.eventId })
            return
          }
          if (payload.event === 'instance.connection' || payload.event === 'instance.paired') {
            bindPrivateMedia(instanceName)
            snapshotPrivateMedia()
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
        // Admin keys cannot operate sessions — instance API key only.
        if (actor.role === 'admin') {
          throw new Error('FORBIDDEN')
        }
        if (actor.instanceName !== instanceName) {
          throw new Error('FORBIDDEN')
        }
        await manager.get(instanceName)
        if (closed) return
        privateMedia?.close()
        privateMedia = null
        privateClient = null
        attached = instanceName
        bindBus(instanceName)
        const calls = snapshotCalls(instanceName)
        const device = await deviceStatus(instanceName)
        if (closed) return
        const mode = bindPrivateMedia(instanceName)
        send({ op: 'ready', instance: instanceName, role, mediaMode: mode, mlowRed: deps.env.VOIP_MLOW_RED })
        send({ op: 'device:status', ...device })
        send({ op: 'calls:snapshot', calls })
        snapshotPrivateMedia()
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

        // Instance API key only for VoIP control; admin is collection-only.
        if (actor.role === 'admin') {
          send({
            op: 'error',
            code: 'FORBIDDEN',
            message: 'Admin API key cannot use VoIP. Use an instance API key.',
          })
          socket.close()
          return
        }

        const preferred = actor.instanceName
        try {
          await doAttach(preferred, actor.role)
        } catch (err) {
          send({
            op: 'error',
            code: 'ATTACH_FAILED',
            message: err instanceof Error ? err.message : 'attach failed',
          })
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

          if (op !== 'call:media_event') log.info({ op, id, attached }, 'voip-ws ← client')

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

            if (op === 'call:media_event') {
              // Never let private host frames or decode exceptions reach command logging.
              try {
                bindPrivateMedia(attached)
                if (!privateMedia || typeof msg.callId !== 'string' || typeof msg.event !== 'string')
                  throw new Error('Invalid host event')
                privateMedia.receive(msg.callId, msg.event)
                ackOk(id)
              } catch {
                ackErr(id, 'INVALID_MEDIA_EVENT', 'Invalid remote media event for this instance and live call')
              }
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
              bindPrivateMedia(attached)

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
              const isVideo = msg.video === true
              const mediaType = isVideo ? 'video' : 'audio'
              let callId: string
              try {
                callId = await withTimeout(client.voip.startCall({ peerJid, isVideo }), 15_000, 'startCall')
              } catch (err) {
                if (!isNotOnWhatsAppError(err)) throw err
                ackErr(
                  id,
                  'NOT_ON_WHATSAPP',
                  `${phone} não tem WhatsApp (nenhum dispositivo encontrado) — confira o número`,
                )
                return
              }

              try {
                if (clientMediaMode(client) === 'local') client.voip.setExternalAudioMode(callId, true)
              } catch (err) {
                log.warn({ err, callId }, 'setExternalAudioMode after start failed')
              }
              if (callRecording) {
                await callRecording.onCallStarted(attached, {
                  callId,
                  peerJid,
                  direction: 'outbound',
                  mediaType,
                  state: 'calling',
                })
              }
              const call = client.voip.getCall(callId)
              const serialized = call
                ? serializeCallInfo(call, { mappedPn: peerJid, mediaMode: clientMediaMode(client) })
                : {
                    callId,
                    mediaMode: clientMediaMode(client),
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
                    mediaType,
                    createdAt: null,
                    audioMuted: undefined,
                    peerAudioMuted: null,
                    handRaised: false,
                    raisedHands: [],
                    videoOff: !isVideo,
                    isGroup: false,
                    groupJid: null,
                    participants: [],
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
              bindPrivateMedia(attached)
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
              const snap = serializeCallInfo(resolved, { mediaMode: clientMediaMode(client) })
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
                if (clientMediaMode(client) === 'local') client.voip.setExternalAudioMode(resolved.callId, true)
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
                      if (after)
                        send({
                          op: 'call:state',
                          call: serializeCallInfo(after, { mediaMode: clientMediaMode(client) }),
                        })
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
                call: {
                  ...serializeCallInfo(resolved, { mediaMode: clientMediaMode(client) }),
                  state: 'ended',
                  isEnded: true,
                },
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

            if (op === 'call:hand') {
              if (!msg.callId || typeof msg.raised !== 'boolean') {
                ackErr(id, 'INVALID_PAYLOAD', 'callId + raised required')
                return
              }
              const client = asVoipClient(manager.requireRegisteredClient(attached))
              const callId = await setCallHand(client, msg.callId, msg.raised)
              if (!callId) ackErr(id, 'CALL_NOT_FOUND', 'call not found')
              else ackOk(id, { callId, raised: msg.raised })
              return
            }

            if (op === 'call:reaction') {
              const reaction = typeof msg.reaction === 'string' ? msg.reaction.trim() : ''
              if (!msg.callId || !reaction || reaction.length > 32) {
                ackErr(id, 'INVALID_PAYLOAD', 'callId + reaction (1-32 chars) required')
                return
              }
              const client = asVoipClient(manager.requireRegisteredClient(attached))
              const result = sendCallReaction(client, msg.callId, reaction)
              if (!result) ackErr(id, 'CALL_NOT_FOUND', 'call not found')
              else if (!result.sent) ackErr(id, 'CALL_NOT_READY', 'call not active or reaction channel not open yet')
              else ackOk(id, { callId: result.callId, reaction })
              return
            }

            if (op === 'call:leave' || op === 'call:join') {
              if (!msg.callId) {
                ackErr(id, 'INVALID_PAYLOAD', 'callId required')
                return
              }
              const client = asVoipClient(manager.requireRegisteredClient(attached))
              if (op === 'call:join') {
                ackOk(id, { callId: await joinGroupCall(client, msg.callId) })
                return
              }
              const callId = await leaveGroupCall(client, msg.callId)
              if (!callId) ackErr(id, 'CALL_NOT_FOUND', 'call not found')
              else ackOk(id, { callId })
              return
            }

            if (op === 'call:video_upgrade') {
              if (!msg.callId) {
                ackErr(id, 'INVALID_PAYLOAD', 'callId required')
                return
              }
              const client = asVoipClient(manager.requireRegisteredClient(attached))
              const res = await requestVideoUpgrade(client, msg.callId)
              if (!res) ackErr(id, 'CALL_NOT_FOUND', 'call not found')
              else ackOk(id, res)
              return
            }

            const upgradeAnswer = op ? UPGRADE_ANSWER_OPS[op] : undefined
            if (upgradeAnswer) {
              if (!msg.callId) {
                ackErr(id, 'INVALID_PAYLOAD', 'callId required')
                return
              }
              const client = asVoipClient(manager.requireRegisteredClient(attached))
              const callId = await answerVideoUpgrade(client, msg.callId, upgradeAnswer)
              if (!callId) ackErr(id, 'CALL_NOT_FOUND', 'call not found')
              else ackOk(id, { callId })
              return
            }

            if (op === 'call:video' || op === 'call:screen_share') {
              const field = op === 'call:video' ? 'enabled' : 'sharing'
              const flag = msg[field]
              if (!msg.callId || typeof flag !== 'boolean') {
                ackErr(id, 'INVALID_PAYLOAD', `callId + ${field} required`)
                return
              }
              const client = asVoipClient(manager.requireRegisteredClient(attached))
              const callId =
                op === 'call:video'
                  ? await setGroupVideo(client, msg.callId, flag)
                  : await setScreenShare(client, msg.callId, flag)
              if (!callId) ackErr(id, 'CALL_NOT_FOUND', 'call not found')
              else ackOk(id, { callId, [field]: flag })
              return
            }

            if (op === 'call:mute_participant') {
              const participant = typeof msg.participant === 'string' ? msg.participant.trim() : ''
              if (!msg.callId || !participant) {
                ackErr(id, 'INVALID_PAYLOAD', 'callId + participant required')
                return
              }
              const client = asVoipClient(manager.requireRegisteredClient(attached))
              const callId = await requestParticipantMute(client, msg.callId, participant)
              if (!callId) ackErr(id, 'CALL_NOT_FOUND', 'call not found')
              else ackOk(id, { callId, participant })
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
        privateMedia?.close()
        privateMedia = null
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
