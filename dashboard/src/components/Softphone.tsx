import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  type CallHistoryItem,
  callDisplayJid,
  getCallRecordingSettings,
  getInstanceHint,
  getStoredKey,
  acceptCall as httpAcceptCall,
  type LiveCall,
  listCallHistory,
  setCallRecording,
  setInstanceHint,
  shortPhone,
} from '../api/client'
import {
  ensureMicPermission,
  listAudioDevices,
  loadAudioPrefs,
  type MediaDeviceOption,
  type SoftphoneAudioPrefs,
  saveAudioPrefs,
} from '../voip/audio-settings'
import { type CallAudioHandles, startCallAudio } from '../voip/call-audio'
import { type VoipConnectionState, voipSocket } from '../voip/voip-socket'

/** Softphone mounts outside <Route>, so useParams() is empty — parse path. */
function useActiveInstanceName(): string {
  const { pathname } = useLocation()
  const fromPath = pathname.match(/^\/instances\/([^/]+)/)?.[1]
  const name = fromPath ? decodeURIComponent(fromPath) : (getInstanceHint() ?? '')
  useEffect(() => {
    if (name) setInstanceHint(name)
  }, [name])
  return name
}

/**
 * idle → dialing → ringing (outbound wait)
 * idle → incoming → active (inbound accept)
 * * → ended → idle
 *
 * IMPORTANT (zapo-js/voip):
 * - Outbound call state is "ringing" — cannot accept.
 * - Inbound call state is "incoming_ringing" — canAccept true.
 * - Media is Active only after SCTP connects (media_connected).
 */
type Phase = 'idle' | 'dialing' | 'ringing' | 'incoming' | 'connecting' | 'active' | 'ended'
type Tab = 'dialer' | 'history' | 'settings'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const

function sameId(a?: string | null, b?: string | null) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

/** Merge call snapshots without losing a known phone when WA flips peer to @lid. */
function mergeCallSnapshot(prev: LiveCall | null, next: LiveCall): LiveCall {
  const prevDisplay = callDisplayJid(prev)
  const nextDisplay = callDisplayJid(next)
  const preferPn =
    prevDisplay && !prevDisplay.includes('@lid') && (!nextDisplay || nextDisplay.includes('@lid'))
      ? prevDisplay
      : (nextDisplay ?? prevDisplay)

  return {
    ...prev,
    ...next,
    peerJid: preferPn ?? next.peerJid ?? prev?.peerJid ?? null,
    callerPn: next.callerPn ?? prev?.callerPn ?? null,
    peerJidRaw: next.peerJidRaw ?? next.peerJid ?? prev?.peerJidRaw ?? null,
    peerLid: next.peerLid ?? prev?.peerLid ?? null,
  }
}

function mapServerStateToPhase(call: LiveCall, fallback: Phase): Phase {
  const st = (call.state ?? '').toLowerCase()
  if (call.isEnded || st === 'ended') return 'ended'
  if (call.isActive || st === 'active' || st === 'on_hold') return 'active'
  if (st === 'connecting') return 'connecting'
  // After the user hits Atender we stay on connecting/active even if a stale
  // snapshot still says incoming_ringing (accept is fire-and-forget on the server).
  if ((fallback === 'connecting' || fallback === 'active') && (call.canAccept || st === 'incoming_ringing')) {
    return fallback
  }
  if (call.canAccept || st === 'incoming_ringing') return 'incoming'
  if (st === 'ringing' || st === 'initiating') {
    return call.direction === 'incoming' ? 'incoming' : 'ringing'
  }
  return fallback
}

export function Softphone() {
  const instanceName = useActiveInstanceName()
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [tab, setTab] = useState<Tab>('dialer')
  const [phone, setPhone] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [activeCall, setActiveCall] = useState<LiveCall | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [history, setHistory] = useState<CallHistoryItem[]>([])
  const [recEnabled, setRecEnabled] = useState(false)
  const [storageReady, setStorageReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [incomingFlash, setIncomingFlash] = useState(false)
  const [audioPrefs, setAudioPrefs] = useState<SoftphoneAudioPrefs>(() => loadAudioPrefs())
  const [mics, setMics] = useState<MediaDeviceOption[]>([])
  const [speakers, setSpeakers] = useState<MediaDeviceOption[]>([])
  const [micLevel, setMicLevel] = useState(0)
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [voipConn, setVoipConn] = useState<VoipConnectionState>(voipSocket.connection)

  const wsRef = useRef<WebSocket | null>(null)
  const audioRef = useRef<CallAudioHandles | null>(null)
  const mutedRef = useRef(false)
  const activeSinceRef = useRef<number | null>(null)
  const callIdRef = useRef<string | null>(null)
  const phaseRef = useRef<Phase>('idle')
  const streamingRef = useRef(false)
  const audioPrefsRef = useRef(audioPrefs)

  mutedRef.current = muted
  phaseRef.current = phase
  audioPrefsRef.current = audioPrefs

  const statusLabel = useMemo(() => {
    if (phase === 'incoming') return 'Chamada recebida'
    if (phase === 'dialing') return 'Discando…'
    if (phase === 'ringing') return 'Chamando…'
    if (phase === 'connecting') return 'Conectando mídia…'
    if (phase === 'active') return formatDuration(elapsed)
    if (phase === 'ended') return 'Encerrada'
    return instanceName ? `Linha · ${instanceName}` : 'Sem instância'
  }, [phase, elapsed, instanceName])

  const loadSettings = useCallback(async () => {
    if (!instanceName) return
    try {
      const s = await getCallRecordingSettings(instanceName)
      setRecEnabled(s.callRecordingEnabled)
      setStorageReady(s.storageReady)
    } catch {
      /* */
    }
  }, [instanceName])

  const loadHistory = useCallback(async () => {
    if (!instanceName) return
    try {
      const { calls } = await listCallHistory(instanceName, { limit: 40 })
      setHistory(calls)
    } catch {
      /* */
    }
  }, [instanceName])

  const refreshDevices = useCallback(async () => {
    setDevicesLoading(true)
    try {
      await ensureMicPermission()
      const { mics: m, speakers: s } = await listAudioDevices()
      setMics(m)
      setSpeakers(s)
    } catch {
      /* */
    } finally {
      setDevicesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (open && tab === 'history') void loadHistory()
    if (open && tab === 'settings') void refreshDevices()
  }, [open, tab, loadHistory, refreshDevices])

  useEffect(() => {
    const onChange = () => void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange)
  }, [refreshDevices])

  // Timer only while Active (media connected)
  useEffect(() => {
    if (phase !== 'active') return
    if (!activeSinceRef.current) activeSinceRef.current = Date.now()
    const t = setInterval(() => {
      if (activeSinceRef.current) {
        setElapsed(Math.floor((Date.now() - activeSinceRef.current) / 1000))
      }
    }, 250)
    return () => clearInterval(t)
  }, [phase])

  // Mic level meter while streaming
  useEffect(() => {
    if (!streaming) {
      setMicLevel(0)
      return
    }
    const t = setInterval(() => {
      setMicLevel(audioRef.current?.getMicLevel() ?? 0)
    }, 100)
    return () => clearInterval(t)
  }, [streaming])

  const cleanupAudio = useCallback(() => {
    streamingRef.current = false
    setStreaming(false)
    try {
      audioRef.current?.stop()
    } catch {
      /* */
    }
    audioRef.current = null
    if (wsRef.current) {
      try {
        wsRef.current.close()
      } catch {
        /* */
      }
      wsRef.current = null
    }
    setMicLevel(0)
  }, [])

  const updatePrefs = useCallback((patch: Partial<SoftphoneAudioPrefs>) => {
    setAudioPrefs((prev) => {
      const next = { ...prev, ...patch }
      saveAudioPrefs(next)
      audioRef.current?.setPrefs(next)
      if (patch.speakerId !== undefined) {
        void audioRef.current?.setSpeakerId(patch.speakerId)
      }
      return next
    })
  }, [])

  const applyCallSnapshot = useCallback(
    (call: LiveCall) => {
      if (!call.callId) return
      if (callIdRef.current && !sameId(callIdRef.current, call.callId)) {
        if (phaseRef.current !== 'idle' && phaseRef.current !== 'ended') return
      }
      callIdRef.current = call.callId
      setActiveCall((prev) => mergeCallSnapshot(prev, call))
      const next = mapServerStateToPhase(call, phaseRef.current)
      setPhase(next)
      phaseRef.current = next
      if (next === 'active' && !activeSinceRef.current) {
        activeSinceRef.current = Date.now()
        setElapsed(0)
      }
      if (next === 'incoming') {
        setOpen(true)
        setMinimized(false)
        setIncomingFlash(true)
      }
      if (next === 'ended') {
        setIncomingFlash(false)
        cleanupAudio()
        callIdRef.current = null
        activeSinceRef.current = null
        setTimeout(() => {
          setPhase('idle')
          phaseRef.current = 'idle'
          setActiveCall(null)
        }, 1200)
        void loadHistory()
      }
    },
    [cleanupAudio, loadHistory],
  )

  /**
   * Open mic + PCM WebSocket. Safe while still ringing (outbound):
   * external mode is enabled server-side on start/accept; feedLiveAudio primes the buffer.
   */
  const openStream = useCallback(
    async (callId: string) => {
      if (streamingRef.current && sameId(callIdRef.current, callId) && wsRef.current) {
        return
      }
      const key = getStoredKey()
      if (!key || !instanceName) throw new Error('Not authenticated')

      cleanupAudio()
      streamingRef.current = true
      setStreaming(true)
      callIdRef.current = callId

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl = `${proto}://${window.location.host}/v1/instances/${encodeURIComponent(instanceName)}/calls/${encodeURIComponent(callId)}/stream?apiKey=${encodeURIComponent(key)}`
      const ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      await new Promise<void>((resolve, reject) => {
        let settled = false
        const settle = (fn: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(t)
          fn()
        }
        const t = setTimeout(() => settle(() => reject(new Error('timeout ao abrir stream de áudio'))), 15_000)
        ws.onmessage = (ev) => {
          if (typeof ev.data === 'string') {
            try {
              const msg = JSON.parse(ev.data) as {
                op?: string
                state?: string
                isActive?: boolean
              }
              if (msg.op === 'ready') {
                settle(() => resolve())
              }
              if (msg.op === 'state') {
                setActiveCall((prev) => {
                  if (!prev || !sameId(prev.callId, callId)) return prev
                  const next = {
                    ...prev,
                    state: msg.state ?? prev.state,
                    isActive: msg.isActive ?? prev.isActive,
                  }
                  const ph = mapServerStateToPhase(next, phaseRef.current)
                  if (ph !== phaseRef.current) {
                    setPhase(ph)
                    phaseRef.current = ph
                    if (ph === 'active' && !activeSinceRef.current) {
                      activeSinceRef.current = Date.now()
                      setElapsed(0)
                    }
                  }
                  return next
                })
              }
              if (msg.op === 'ended') {
                setPhase('ended')
                phaseRef.current = 'ended'
                cleanupAudio()
              }
            } catch {
              /* */
            }
            return
          }
          // Peer PCM
          audioRef.current?.pushRemotePcm(ev.data as ArrayBuffer)
        }
        ws.onerror = () => {
          settle(() => reject(new Error('erro no WebSocket de áudio')))
        }
        // Critical: reject if server closes before ready (e.g. 4403 forbidden / 4404 not found).
        // Old code only cleared the timer — Promise hung forever and "Atender" never finished.
        ws.onclose = (ev) => {
          settle(() =>
            reject(
              new Error(`stream de áudio fechou antes do ready (code=${ev.code}${ev.reason ? ` ${ev.reason}` : ''})`),
            ),
          )
        }
      })

      // Start capture after WS is ready so first frames are delivered
      const handles = await startCallAudio({
        ws,
        prefs: audioPrefsRef.current,
        muted: mutedRef.current,
        onError: (err) => setError(err.message),
      })
      audioRef.current = handles
    },
    [instanceName, cleanupAudio],
  )

  const hangup = useCallback(async () => {
    const id = callIdRef.current ?? activeCall?.callId
    if (id) {
      try {
        await voipSocket.endCall(id)
      } catch {
        /* */
      }
    }
    cleanupAudio()
    setPhase('ended')
    phaseRef.current = 'ended'
    setActiveCall(null)
    callIdRef.current = null
    activeSinceRef.current = null
    setIncomingFlash(false)
    setTimeout(() => {
      setPhase('idle')
      phaseRef.current = 'idle'
    }, 1000)
    void loadHistory()
  }, [activeCall, cleanupAudio, loadHistory])

  const placeCall = useCallback(async () => {
    if (!instanceName || !phone.trim()) return
    setBusy(true)
    setError(null)
    setPhase('dialing')
    phaseRef.current = 'dialing'
    activeSinceRef.current = null
    setElapsed(0)
    try {
      // Wait for control WS (auto-reconnect) before startCall
      await voipSocket.ensureConnected()
      const res = await voipSocket.startCall(phone.trim())
      if (!res.ok) throw new Error(res.message)
      const data = (res.data ?? {}) as { callId?: string; peerJid?: string; call?: LiveCall }
      const callId = data.callId ?? data.call?.callId
      if (!callId) throw new Error('callId missing from voip ack')
      // Keep dialed number for display even if WA immediately reports peer as @lid
      const dialedPn = phone.trim().includes('@') ? phone.trim() : `${phone.trim().replace(/\D/g, '')}@s.whatsapp.net`
      const peerJid = data.peerJid ?? data.call?.peerJid ?? dialedPn
      callIdRef.current = callId
      const base: LiveCall = data.call ?? {
        callId,
        peerJid,
        direction: 'outgoing',
        state: 'ringing',
        isActive: false,
        isRinging: true,
        isEnded: false,
        canAccept: false,
      }
      setActiveCall(
        mergeCallSnapshot(null, {
          ...base,
          peerJid: callDisplayJid(base)?.includes('@lid') ? dialedPn : (callDisplayJid(base) ?? dialedPn),
          callerPn: base.callerPn ?? dialedPn,
        }),
      )
      setPhase('ringing')
      phaseRef.current = 'ringing'
      setOpen(true)
      await openStream(callId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao ligar')
      setPhase('idle')
      phaseRef.current = 'idle'
      cleanupAudio()
      callIdRef.current = null
    } finally {
      setBusy(false)
    }
  }, [instanceName, phone, openStream, cleanupAudio])

  const onAccept = useCallback(async () => {
    if (!instanceName) {
      setError('Abra a página da instância (instances/…) antes de atender')
      return
    }
    const wanted = callIdRef.current ?? activeCall?.callId
    if (!wanted) {
      setError('Nenhuma chamada para atender')
      return
    }
    // Prefer server-side canAccept; only hard-block clear outbound cases.
    if (
      activeCall &&
      activeCall.canAccept === false &&
      activeCall.state !== 'incoming_ringing' &&
      activeCall.direction !== 'incoming'
    ) {
      setError(`Não dá pra atender: estado="${activeCall.state}" direção=${activeCall.direction}. Só incoming_ringing.`)
      return
    }

    // Optimistic UI immediately — never leave the user staring at Atender.
    setBusy(true)
    setError(null)
    setIncomingFlash(false)
    setPhase('connecting')
    phaseRef.current = 'connecting'
    callIdRef.current = wanted
    setActiveCall((prev) =>
      prev && sameId(prev.callId, wanted) ? { ...prev, state: 'connecting', canAccept: false, isRinging: false } : prev,
    )

    try {
      let callId = wanted
      let acceptErr: unknown = null

      // Prefer VoIP WS when connected (push ack + call snapshot). HTTP fallback
      // is non-blocking on the server (acceptCall runs after the response).
      if (voipSocket.connection === 'connected') {
        try {
          const res = await voipSocket.acceptCall(wanted)
          if (res.ok) {
            const data = (res.data ?? {}) as { callId?: string; call?: LiveCall }
            callId = data.callId ?? wanted
            const accepted = data.call
            if (accepted) {
              setActiveCall((prev) => mergeCallSnapshot(prev, { ...accepted, canAccept: false }))
              const ph = mapServerStateToPhase(accepted, 'connecting')
              if (ph !== 'incoming') {
                setPhase(ph)
                phaseRef.current = ph
              }
            }
          } else {
            acceptErr = new Error(`${res.code ?? 'ERR'}: ${res.message}`)
          }
        } catch (wsErr) {
          acceptErr = wsErr
        }
      } else {
        acceptErr = new Error('VoIP WS offline')
      }

      if (acceptErr) {
        try {
          await httpAcceptCall(instanceName, wanted)
          acceptErr = null
        } catch (httpErr) {
          const wsMsg = acceptErr instanceof Error ? acceptErr.message : String(acceptErr)
          const httpMsg = httpErr instanceof Error ? httpErr.message : String(httpErr)
          throw new Error(`Atender falhou — ws: ${wsMsg} | http: ${httpMsg}`)
        }
      }

      callIdRef.current = callId
      try {
        await openStream(callId)
      } catch (streamErr) {
        setError(streamErr instanceof Error ? streamErr.message : 'Áudio falhou após atender')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atender')
      // Roll back only if we never left the offer (server rejected).
      if (phaseRef.current === 'connecting') {
        setPhase('incoming')
        phaseRef.current = 'incoming'
        setActiveCall((prev) =>
          prev && sameId(prev.callId, wanted)
            ? { ...prev, state: 'incoming_ringing', canAccept: true, isRinging: true }
            : prev,
        )
      }
    } finally {
      setBusy(false)
    }
  }, [instanceName, activeCall, openStream])

  const onReject = useCallback(async () => {
    if (!instanceName) return
    const id = callIdRef.current ?? activeCall?.callId
    if (id) {
      try {
        await voipSocket.rejectCall(id)
      } catch {
        /* */
      }
    }
    cleanupAudio()
    setPhase('idle')
    phaseRef.current = 'idle'
    setActiveCall(null)
    callIdRef.current = null
    setIncomingFlash(false)
  }, [instanceName, activeCall, cleanupAudio])

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m
      audioRef.current?.setMuted(next)
      return next
    })
  }, [])

  // VoIP control plane (no HTTP polling) — keep socket while instance is active
  useEffect(() => {
    if (!instanceName || !getStoredKey()) return

    const unsub = voipSocket.subscribe({
      onConnection: (s) => {
        setVoipConn(s)
        if (s === 'connected') {
          // clear stale disconnect errors
          setError((prev) => (prev && /voip || socket || conect/i.test(prev) ? null : prev))
        }
      },
      onCallOffer: (call) => {
        if (call.canAccept || call.state === 'incoming_ringing' || call.direction === 'incoming') {
          applyCallSnapshot({
            ...call,
            canAccept: call.canAccept ?? true,
            direction: call.direction ?? 'incoming',
          })
        }
      },
      onCallRinging: (call) => {
        if (!callIdRef.current || sameId(callIdRef.current, call.callId)) applyCallSnapshot(call)
      },
      onCallAccepted: (call) => {
        if (!callIdRef.current || sameId(callIdRef.current, call.callId)) applyCallSnapshot(call)
      },
      onCallState: (call) => {
        if (!callIdRef.current || sameId(callIdRef.current, call.callId)) applyCallSnapshot(call)
      },
      onCallEnded: (call) => {
        if (!callIdRef.current || sameId(callIdRef.current, call.callId) || phaseRef.current === 'incoming') {
          applyCallSnapshot({ ...call, isEnded: true, state: call.state ?? 'ended' })
        }
      },
      onCallsSnapshot: (calls) => {
        if (phaseRef.current === 'idle' || phaseRef.current === 'ended') {
          const incoming = calls.find((c) => c.canAccept)
          if (incoming) applyCallSnapshot(incoming)
        } else if (callIdRef.current) {
          const cur = calls.find((c) => sameId(c.callId, callIdRef.current))
          if (cur) applyCallSnapshot(cur)
        }
      },
      onError: (message) => setError(message),
    })

    voipSocket.acquire(instanceName)
    // Proactively wait once so first dial is faster / surfaces errors early
    void voipSocket.ensureConnected().catch((err) => {
      setError(err instanceof Error ? err.message : 'VoIP offline')
    })

    return () => {
      unsub()
      voipSocket.release()
    }
  }, [instanceName, applyCallSnapshot])

  useEffect(() => () => cleanupAudio(), [cleanupAudio])

  if (!instanceName) return null

  const inCall =
    phase === 'dialing' || phase === 'ringing' || phase === 'incoming' || phase === 'connecting' || phase === 'active'

  const levelPct = Math.min(100, Math.round(micLevel * 400))

  return (
    <>
      <button
        type="button"
        className={`softphone-fab ${incomingFlash ? 'ringing' : ''} ${phase === 'active' || phase === 'connecting' ? 'on-call' : ''}`}
        title="Softphone"
        onClick={() => {
          setOpen(true)
          setMinimized(false)
        }}
      >
        <span className="softphone-fab-icon">☎</span>
        {incomingFlash && <span className="softphone-fab-badge">1</span>}
      </button>

      {open && !minimized && (
        <div className="softphone-window" role="dialog" aria-label="Softphone">
          <div className="softphone-titlebar">
            <div>
              <strong>Softphone</strong>
              <div className="softphone-sub">{statusLabel}</div>
              <div className={`softphone-conn softphone-conn-${voipConn}`} title="Canal de sinalização /v1/voip">
                <span className="softphone-conn-dot" />
                {voipConn === 'connected'
                  ? 'VoIP online'
                  : voipConn === 'connecting'
                    ? 'VoIP conectando…'
                    : 'VoIP offline (API?)'}
                {voipConn !== 'connected' && (
                  <button
                    type="button"
                    className="softphone-conn-retry"
                    onClick={() => {
                      setError(null)
                      voipSocket.reconnect()
                      void voipSocket.ensureConnected().catch((err) => {
                        setError(err instanceof Error ? err.message : 'VoIP offline')
                      })
                    }}
                  >
                    Reconectar
                  </button>
                )}
              </div>
              {voipConn !== 'connected' && phase === 'incoming' && (
                <p className="softphone-error" style={{ marginTop: 4, fontSize: 12 }}>
                  Sinalização offline — a API pode ter caído. Reconecte antes de Atender.
                </p>
              )}
            </div>
            <div className="softphone-title-actions">
              <button type="button" className="icon-btn" onClick={() => setMinimized(true)} title="Minimizar">
                —
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  if (inCall) void hangup()
                  else setOpen(false)
                }}
                title="Fechar"
              >
                ×
              </button>
            </div>
          </div>

          {!inCall && phase !== 'ended' && (
            <div className="softphone-tabs">
              <button type="button" className={tab === 'dialer' ? 'active' : ''} onClick={() => setTab('dialer')}>
                Discador
              </button>
              <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
                Histórico
              </button>
              <button type="button" className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
                Áudio
              </button>
            </div>
          )}

          {error && <div className="softphone-error">{error}</div>}

          {phase === 'incoming' && activeCall && (
            <div className="softphone-call-panel incoming">
              <div className="softphone-avatar">☎</div>
              <div className="softphone-peer">{shortPhone(callDisplayJid(activeCall))}</div>
              <p className="muted">
                Chamada recebida
                {activeCall.state ? ` · ${activeCall.state}` : ''}
                {activeCall.canAccept === false ? ' · bloqueada' : ''}
              </p>
              <div className="softphone-call-actions">
                <button type="button" className="btn danger round" disabled={busy} onClick={() => void onReject()}>
                  Recusar
                </button>
                <button
                  type="button"
                  className="btn primary round"
                  disabled={busy || activeCall.canAccept === false}
                  onClick={() => void onAccept()}
                >
                  {busy ? 'Atendendo…' : 'Atender'}
                </button>
              </div>
            </div>
          )}

          {(phase === 'dialing' || phase === 'ringing' || phase === 'connecting' || phase === 'active') &&
            activeCall && (
              <div className="softphone-call-panel">
                <div className={`softphone-avatar ${phase === 'active' ? 'active' : ''}`}>☎</div>
                <div className="softphone-peer">{shortPhone(callDisplayJid(activeCall))}</div>
                <p className="muted">{statusLabel}</p>
                {activeCall.state && (
                  <p className="muted" style={{ fontSize: '0.75rem' }}>
                    estado: {activeCall.state}
                  </p>
                )}
                <div className="softphone-mic-meter" title="Nível do microfone (uplink)">
                  <span className="softphone-mic-label">Mic</span>
                  <div className="softphone-mic-bar">
                    <div className="softphone-mic-fill" style={{ width: `${levelPct}%` }} />
                  </div>
                </div>
                <div className="softphone-call-actions">
                  <button type="button" className={`btn ghost round ${muted ? 'muted-on' : ''}`} onClick={toggleMute}>
                    {muted ? 'Unmute' : 'Mute'}
                  </button>
                  <button type="button" className="btn danger round" onClick={() => void hangup()}>
                    Desligar
                  </button>
                </div>
              </div>
            )}

          {phase === 'ended' && (
            <div className="softphone-call-panel">
              <p className="muted">Chamada encerrada</p>
            </div>
          )}

          {phase === 'idle' && tab === 'dialer' && (
            <div className="softphone-dialer">
              <input
                className="softphone-number"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d+*#]/g, ''))}
                placeholder="5511…"
                inputMode="tel"
              />
              <div className="softphone-keypad">
                {KEYS.map((k) => (
                  <button key={k} type="button" className="key" onClick={() => setPhone((p) => p + k)}>
                    {k}
                  </button>
                ))}
              </div>
              <div className="softphone-dial-actions">
                <button type="button" className="btn ghost" onClick={() => setPhone((p) => p.slice(0, -1))}>
                  ⌫
                </button>
                <button
                  type="button"
                  className="btn primary call-btn"
                  disabled={busy || phone.length < 8}
                  onClick={() => void placeCall()}
                >
                  Ligar
                </button>
              </div>
            </div>
          )}

          {phase === 'idle' && tab === 'history' && (
            <div className="softphone-history">
              <button type="button" className="btn ghost small" onClick={() => void loadHistory()}>
                Atualizar
              </button>
              {history.length === 0 && <p className="muted">Sem chamadas</p>}
              <ul>
                {history.map((c) => (
                  <li key={c.callId}>
                    <div>
                      <strong>{shortPhone(callDisplayJid(c) ?? c.peerJid)}</strong>
                      <span className="muted">
                        {' '}
                        · {c.direction} · {c.durationSecs ?? 0}s
                      </span>
                      <div className="softphone-hist-meta">
                        {new Date(c.startedAt).toLocaleString()} · rec: {c.recording.status}
                      </div>
                    </div>
                    {c.recording.status === 'ready' && c.recording.downloadPath && (
                      <a
                        className="btn ghost small"
                        href={c.recording.downloadPath}
                        onClick={async (e) => {
                          e.preventDefault()
                          const key = getStoredKey()
                          if (!key) return
                          const path = c.recording.downloadPath
                          if (!path) return
                          const res = await fetch(path, {
                            headers: { 'X-Api-Key': key },
                          })
                          const blob = await res.blob()
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `call-${c.callId}.wav`
                          a.click()
                          URL.revokeObjectURL(url)
                        }}
                      >
                        WAV
                      </a>
                    )}
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => {
                        if (c.peerJid) setPhone(c.peerJid.split('@')[0] ?? '')
                        setTab('dialer')
                      }}
                    >
                      ↺
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {phase === 'idle' && tab === 'settings' && (
            <div className="softphone-settings">
              <div className="softphone-settings-head">
                <strong>Dispositivos</strong>
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={devicesLoading}
                  onClick={() => void refreshDevices()}
                >
                  {devicesLoading ? '…' : 'Atualizar'}
                </button>
              </div>

              <label className="softphone-field">
                <span>Microfone</span>
                <select value={audioPrefs.micId} onChange={(e) => updatePrefs({ micId: e.target.value })}>
                  <option value="">Padrão do sistema</option>
                  {mics.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="softphone-field">
                <span>Alto-falante / fone</span>
                <select value={audioPrefs.speakerId} onChange={(e) => updatePrefs({ speakerId: e.target.value })}>
                  <option value="">Padrão do sistema</option>
                  {speakers.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
                {speakers.length === 0 && (
                  <span className="softphone-hint">
                    Seleção de saída depende do navegador (Chrome/Edge). Firefox pode não listar.
                  </span>
                )}
              </label>

              <label className="softphone-field">
                <span>Ganho do microfone ({audioPrefs.micGain.toFixed(1)}×)</span>
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.1}
                  value={audioPrefs.micGain}
                  onChange={(e) => updatePrefs({ micGain: Number(e.target.value) })}
                />
              </label>

              <label className="softphone-toggle">
                <input
                  type="checkbox"
                  checked={audioPrefs.noiseFilter}
                  onChange={(e) => updatePrefs({ noiseFilter: e.target.checked })}
                />
                Filtro de ruído client-side (high-pass + noise gate)
              </label>

              <label className="softphone-toggle">
                <input
                  type="checkbox"
                  checked={audioPrefs.browserNoiseSuppression}
                  onChange={(e) => updatePrefs({ browserNoiseSuppression: e.target.checked })}
                />
                Noise suppression do navegador
              </label>

              <label className="softphone-toggle">
                <input
                  type="checkbox"
                  checked={audioPrefs.echoCancellation}
                  onChange={(e) => updatePrefs({ echoCancellation: e.target.checked })}
                />
                Cancelamento de eco
              </label>

              <label className="softphone-toggle">
                <input
                  type="checkbox"
                  checked={audioPrefs.autoGainControl}
                  onChange={(e) => updatePrefs({ autoGainControl: e.target.checked })}
                />
                Auto gain (AGC)
              </label>

              <hr className="softphone-sep" />

              <p className="muted" style={{ margin: 0 }}>
                Gravações exigem storage ({storageReady ? 'OK' : 'não pronto'}). WAV estéreo L=local R=remoto.
              </p>
              <label className="softphone-toggle">
                <input
                  type="checkbox"
                  checked={recEnabled}
                  disabled={!storageReady && !recEnabled}
                  onChange={(e) => {
                    void (async () => {
                      try {
                        const r = await setCallRecording(instanceName, e.target.checked)
                        setRecEnabled(r.callRecordingEnabled)
                        setStorageReady(r.storageReady)
                        setError(null)
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Falha')
                      }
                    })()
                  }}
                />
                Gravar chamadas desta instância
              </label>
            </div>
          )}
        </div>
      )}

      {open && minimized && (
        <button
          type="button"
          className={`softphone-pill ${incomingFlash ? 'ringing' : ''}`}
          onClick={() => setMinimized(false)}
        >
          ☎ {statusLabel}
        </button>
      )}
    </>
  )
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
