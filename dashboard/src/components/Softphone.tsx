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
import {
  type CallVideoHandles,
  describeMediaError,
  isVideoCallSupported,
  type OutboundVideoStats,
  startCallVideo,
  startCameraTest,
} from '../voip/call-video'
import { RemoteCallMedia } from '../voip/remote-call-media'
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
    // A call never goes back from video to audio; a snapshot sent before the upgrade settled must not undo it
    mediaType: sameId(prev?.callId ?? '', next.callId) && prev?.mediaType === 'video' ? 'video' : next.mediaType,
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
  const [mediaMode, setMediaMode] = useState<'local' | 'remote'>(voipSocket.mediaMode)
  const [mediaSummary, setMediaSummary] = useState<string | null>(null)
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
  const [cameras, setCameras] = useState<MediaDeviceOption[]>([])
  /** Camera test in settings: running stats, or the error that stopped it. */
  const [cameraTest, setCameraTest] = useState<{ running: boolean; info: string | null; error: string | null }>({
    running: false,
    info: null,
    error: null,
  })
  const [outboundStats, setOutboundStats] = useState<OutboundVideoStats | null>(null)
  const [micLevel, setMicLevel] = useState(0)
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [voipConn, setVoipConn] = useState<VoipConnectionState>(voipSocket.connection)
  const [cameraOn, setCameraOn] = useState(true)
  const [remoteVideoFrames, setRemoteVideoFrames] = useState(0)
  const [screenSharing, setScreenSharing] = useState(false)
  /** Peer asked to turn this audio call into video; answer within ~5 s. */
  const [upgradeAsked, setUpgradeAsked] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const remoteMediaRef = useRef<RemoteCallMedia | null>(null)
  const audioRef = useRef<CallAudioHandles | null>(null)
  const mutedRef = useRef(false)
  const activeSinceRef = useRef<number | null>(null)
  const callIdRef = useRef<string | null>(null)
  const phaseRef = useRef<Phase>('idle')
  const streamingRef = useRef(false)
  const audioPrefsRef = useRef(audioPrefs)
  const videoWsRef = useRef<WebSocket | null>(null)
  const videoRef = useRef<CallVideoHandles | null>(null)
  const localVideoElRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLDivElement | null>(null)
  const cameraOnRef = useRef(true)
  const cameraTestRef = useRef<Awaited<ReturnType<typeof startCameraTest>> | null>(null)
  /** Bumped on every start/stop: a test that resolves after being cancelled stops itself. */
  const cameraTestGenRef = useRef(0)
  const [screenPicking, setScreenPicking] = useState(false)
  const cameraTestVideoRef = useRef<HTMLVideoElement | null>(null)

  cameraOnRef.current = cameraOn
  mutedRef.current = muted
  phaseRef.current = phase
  audioPrefsRef.current = audioPrefs

  const activeCallId = activeCall?.callId ?? null
  const isVideoCall = activeCall?.mediaType === 'video'
  const peerVideoOff = activeCall?.videoOff === true
  // Canvas / <video> live in the call panel — the window stays mounted (hidden) while minimized
  const videoPanelShown =
    open && isVideoCall && (phase === 'dialing' || phase === 'ringing' || phase === 'connecting' || phase === 'active')

  const statusLabel = useMemo(() => {
    if (phase === 'incoming') return isVideoCall ? 'Chamada de vídeo recebida' : 'Chamada recebida'
    if (phase === 'dialing') return 'Discando…'
    if (phase === 'ringing') return 'Chamando…'
    if (phase === 'connecting') return 'Conectando mídia…'
    if (phase === 'active') return formatDuration(elapsed)
    if (phase === 'ended') return 'Encerrada'
    return instanceName ? `Linha · ${instanceName}` : 'Sem instância'
  }, [phase, elapsed, instanceName, isVideoCall])

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
      const { mics: m, speakers: s, cameras: c } = await listAudioDevices()
      setMics(m)
      setSpeakers(s)
      setCameras(c)
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
    remoteMediaRef.current = null
    if (wsRef.current) {
      try {
        wsRef.current.close()
      } catch {
        /* */
      }
      wsRef.current = null
    }
    setMicLevel(0)
    setUpgradeAsked(false)
  }, [])

  const cleanupVideo = useCallback(() => {
    try {
      videoRef.current?.stop()
    } catch {
      /* */
    }
    videoRef.current = null
    if (videoWsRef.current) {
      try {
        videoWsRef.current.close()
      } catch {
        /* */
      }
      videoWsRef.current = null
    }
    setRemoteVideoFrames(0)
    setOutboundStats(null)
    setScreenSharing(false)
  }, [])

  const prepareRemoteMedia = useCallback(
    (callId?: string) => {
      if (voipSocket.mediaMode !== 'remote') return
      cleanupAudio()
      setMediaSummary(null)
      const media = new RemoteCallMedia({
        callId,
        prefs: audioPrefsRef.current,
        onError: setError,
        onStats: (stats) =>
          setMediaSummary(
            `Mídia no navegador · áudio enviado ${stats.audioSent}, recebido ${stats.audioReceived} · erros SRTP ${stats.srtpErrors} · decode ${stats.decodeErrors}`,
          ),
      })
      remoteMediaRef.current = media
      audioRef.current = media
    },
    [cleanupAudio],
  )

  /**
   * Video rides its own WS (.../calls/:id/video) next to the PCM stream. Opens once audio
   * streaming started and the call is a video call; torn down with the audio stream.
   */
  useEffect(() => {
    if (!streaming || !activeCallId || !videoPanelShown) return
    const key = getStoredKey()
    const localVideo = localVideoElRef.current
    const remoteContainer = remoteVideoRef.current
    if (!key || !localVideo || !remoteContainer) return
    if (!isVideoCallSupported()) {
      setError('Navegador sem WebCodecs — chamada segue só com áudio')
      return
    }

    let disposed = false
    if (mediaMode === 'remote') {
      const media = remoteMediaRef.current
      if (!media) return
      void media
        .openVideo(localVideo, remoteContainer, () => {
          setScreenSharing(false)
          void voipSocket.setScreenShare(activeCallId, false)
        })
        .then((handles) => {
          if (disposed) {
            handles.stop()
            return
          }
          handles.setCameraEnabled(cameraOnRef.current)
          videoRef.current = handles
          void refreshDevices()
        })
        .catch(() => setError('Não foi possível iniciar vídeo no navegador'))
      const poll = setInterval(() => {
        setRemoteVideoFrames(videoRef.current?.getRemoteFrames() ?? 0)
        setOutboundStats(videoRef.current?.getOutboundStats() ?? null)
      }, 500)
      return () => {
        disposed = true
        clearInterval(poll)
        cleanupVideo()
      }
    }
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(
      `${proto}://${window.location.host}/v1/calls/${encodeURIComponent(activeCallId)}/video?apiKey=${encodeURIComponent(key)}`,
    )
    ws.binaryType = 'arraybuffer'
    videoWsRef.current = ws

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let msg: { op?: string; videoOff?: boolean; mediaType?: string | null }
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.op === 'ready') {
        void startCallVideo({
          ws,
          localVideo,
          remoteContainer,
          cameraId: audioPrefsRef.current.cameraId,
          onError: (err) => setError(err.message),
          // Browser's own "Stop sharing" bar: tell the peer too
          onScreenShareEnded: () => {
            setScreenSharing(false)
            void voipSocket.setScreenShare(activeCallId, false)
          },
        })
          .then((handles) => {
            if (disposed) {
              handles.stop()
              return
            }
            handles.setCameraEnabled(cameraOnRef.current)
            videoRef.current = handles
            // Camera labels (and "Trocar câmera") need the grant this call just got
            void refreshDevices()
          })
          .catch((err) => setError(err instanceof Error ? err.message : 'Falha ao abrir câmera'))
      }
      if (msg.op === 'ready' || msg.op === 'state') {
        setActiveCall((prev) =>
          prev && sameId(prev.callId, activeCallId)
            ? {
                ...prev,
                videoOff: msg.videoOff ?? prev.videoOff,
                mediaType: prev.mediaType === 'video' ? 'video' : (msg.mediaType ?? prev.mediaType),
              }
            : prev,
        )
      }
    }
    ws.onclose = (ev) => {
      if (!disposed && ev.code !== 1000) {
        setError(`canal de vídeo fechou (code=${ev.code}${ev.reason ? ` ${ev.reason}` : ''})`)
      }
    }

    const poll = setInterval(() => {
      setRemoteVideoFrames(videoRef.current?.getRemoteFrames() ?? 0)
      setOutboundStats(videoRef.current?.getOutboundStats() ?? null)
    }, 500)
    return () => {
      disposed = true
      clearInterval(poll)
      cleanupVideo()
    }
  }, [streaming, activeCallId, videoPanelShown, cleanupVideo, refreshDevices, mediaMode])

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
      if (voipSocket.mediaMode === 'remote') {
        const media = remoteMediaRef.current
        if (!media) throw new Error('Clique em ligar/atender novamente para abrir o áudio no navegador')
        media.bind(callId)
        await media.ready()
        callIdRef.current = callId
        streamingRef.current = true
        setStreaming(true)
        return
      }
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
      const wsUrl = `${proto}://${window.location.host}/v1/calls/${encodeURIComponent(callId)}/stream?apiKey=${encodeURIComponent(key)}`
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

  const placeCall = useCallback(
    async (video: boolean) => {
      if (!instanceName || !phone.trim()) return
      setBusy(true)
      setError(null)
      setPhase('dialing')
      phaseRef.current = 'dialing'
      setCameraOn(true)
      activeSinceRef.current = null
      setElapsed(0)
      try {
        prepareRemoteMedia()
        // Wait for control WS (auto-reconnect) before startCall
        await voipSocket.ensureConnected()
        const res = await voipSocket.startCall(phone.trim(), { video })
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
          mediaType: video ? 'video' : 'audio',
          videoOff: !video,
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
    },
    [instanceName, phone, openStream, cleanupAudio, prepareRemoteMedia],
  )

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
    setCameraOn(true)
    setPhase('connecting')
    phaseRef.current = 'connecting'
    callIdRef.current = wanted
    setActiveCall((prev) =>
      prev && sameId(prev.callId, wanted) ? { ...prev, state: 'connecting', canAccept: false, isRinging: false } : prev,
    )

    try {
      prepareRemoteMedia(wanted)
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
  }, [instanceName, activeCall, openStream, prepareRemoteMedia])

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

  const toggleCamera = useCallback(() => {
    const next = !cameraOnRef.current
    setCameraOn(next)
    videoRef.current?.setCameraEnabled(next)
    // A group call also announces the camera to the others
    if (activeCall?.isGroup) void voipSocket.setGroupVideo(activeCall.callId, next)
  }, [activeCall])

  const stopCameraTest = useCallback(() => {
    cameraTestGenRef.current += 1
    cameraTestRef.current?.stop()
    cameraTestRef.current = null
    setCameraTest((t) => ({ ...t, running: false }))
  }, [])

  /** Same capture + H.264 encoder as a call, without one: proves the camera before dialing. */
  const runCameraTest = useCallback(async () => {
    stopCameraTest()
    const video = cameraTestVideoRef.current
    if (!video) return
    const gen = cameraTestGenRef.current
    setCameraTest({ running: true, info: 'Abrindo câmera…', error: null })
    try {
      const handle = await startCameraTest(video, audioPrefsRef.current.cameraId || undefined)
      // Cancelled (tab switched, window closed, clicked again) while the permission prompt was open
      if (gen !== cameraTestGenRef.current) {
        handle.stop()
        return
      }
      cameraTestRef.current = handle
      // Labels only show once the camera is allowed
      void refreshDevices()
    } catch (err) {
      if (gen !== cameraTestGenRef.current) return
      setCameraTest({ running: false, info: null, error: err instanceof Error ? err.message : String(err) })
    }
  }, [stopCameraTest, refreshDevices])

  // Live readout while the test runs; stops when leaving the settings tab or closing the window
  useEffect(() => {
    if (!cameraTest.running) return
    const t = setInterval(() => {
      const st = cameraTestRef.current?.stats()
      if (!st) return
      setCameraTest((prev) => ({
        ...prev,
        info: `${st.cameraLabel ?? 'câmera'} · ${st.width}×${st.height} · ${st.framesEncoded} frames H.264 codificados`,
        error: st.lastError,
      }))
    }, 500)
    return () => clearInterval(t)
  }, [cameraTest.running])

  useEffect(() => {
    if (!open || tab !== 'settings' || phase !== 'idle') stopCameraTest()
  }, [open, tab, phase, stopCameraTest])

  useEffect(() => () => cameraTestRef.current?.stop(), [])

  /** Next camera in the list, mid-call. The old one stays on if the new one fails to open. */
  const switchCamera = useCallback(async () => {
    if (!videoRef.current || cameras.length < 2) return
    // The pref may be '' (browser default): ask the track which camera that really is
    const current = videoRef.current.currentCameraId() ?? audioPrefsRef.current.cameraId
    const idx = cameras.findIndex((c) => c.deviceId === current)
    const next = cameras[(idx + 1) % cameras.length]
    if (!next) return
    try {
      await videoRef.current.setCamera(next.deviceId)
      updatePrefs({ cameraId: next.deviceId })
    } catch (err) {
      setError(describeMediaError(err, 'câmera'))
    }
  }, [cameras, updatePrefs])

  /** Audio call → video: 1:1 is a handshake with the peer; a group asks the server. */
  const upgradeToVideo = useCallback(async () => {
    if (!activeCall) return
    setBusy(true)
    try {
      const res = await voipSocket.requestVideoUpgrade(activeCall.callId).catch((err: unknown) => ({
        ok: false as const,
        code: 'FAILED',
        message: err instanceof Error ? err.message : String(err),
      }))
      if (!res.ok) {
        setError(res.message)
        return
      }
      const result = (res.data as { result?: string } | undefined)?.result
      if (result !== 'accepted') {
        setError(`Vídeo não iniciado: ${result ?? 'sem resposta'}`)
        return
      }
      // On a group call `accepted` already means our camera is on
      setCameraOn(true)
      setActiveCall((prev) => (prev ? { ...prev, mediaType: 'video' } : prev))
    } finally {
      setBusy(false)
    }
  }, [activeCall])

  const answerUpgrade = useCallback(
    async (accept: boolean) => {
      setUpgradeAsked(false)
      if (!activeCall) return
      const res = await voipSocket.answerVideoUpgrade(activeCall.callId, accept ? 'accept' : 'reject')
      if (!res.ok) setError(res.message)
      else if (accept) {
        setCameraOn(true)
        setActiveCall((prev) => (prev ? { ...prev, mediaType: 'video' } : prev))
      }
    },
    [activeCall],
  )

  const toggleScreenShare = useCallback(async () => {
    if (!activeCall || !videoRef.current || screenPicking) return
    const next = !screenSharing
    // Picker first: announcing a share the user then cancels would show the peer nothing
    setScreenPicking(next)
    const picked = await videoRef.current.setScreenShare(next).finally(() => setScreenPicking(false))
    if (!picked) return
    const res = await voipSocket.setScreenShare(activeCall.callId, next)
    if (!res.ok) {
      // Starting failed: drop the screen we just picked. Stopping failed: the camera is back anyway.
      if (next) await videoRef.current?.setScreenShare(false)
      setScreenSharing(false)
      setError(res.message)
      return
    }
    setScreenSharing(next)
  }, [activeCall, screenSharing, screenPicking])

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
      onReady: setMediaMode,
      onAudioFinished: () => setMediaSummary('Reprodução do arquivo de áudio concluída'),
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
      onVideoEvent: (event) => {
        if (!callIdRef.current || !sameId(callIdRef.current, event.call.callId)) return
        if (event.op === 'call:video_state') {
          setUpgradeAsked(event.upgradeRequested && !event.call.isGroup)
          // Answered (or withdrawn) elsewhere: the peer's next state clears the prompt
        } else if (event.op === 'call:video_upgraded') {
          setActiveCall((prev) => (prev ? { ...prev, mediaType: 'video' } : prev))
        } else if (event.op === 'call:screen_share_changed') {
          setActiveCall((prev) => (prev ? { ...prev, peerScreenSharing: event.sharing } : prev))
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

      {open && (
        <div
          className={`softphone-window ${isVideoCall && phase !== 'idle' ? 'video' : ''}`}
          role="dialog"
          aria-label="Softphone"
          hidden={minimized}
        >
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
                Áudio/vídeo
              </button>
            </div>
          )}

          {mediaMode === 'remote' && (
            <p className="muted">Mídia no navegador · chamadas individuais · HTTPS necessário</p>
          )}
          {mediaSummary && (
            <p className="muted" role="status">
              {mediaSummary}
            </p>
          )}
          {error && <div className="softphone-error">{error}</div>}

          {phase === 'incoming' && activeCall && (
            <div className="softphone-call-panel incoming">
              <div className="softphone-avatar">{isVideoCall ? '🎥' : '☎'}</div>
              <div className="softphone-peer">{shortPhone(callDisplayJid(activeCall))}</div>
              <p className="muted">
                {isVideoCall ? 'Chamada de vídeo recebida' : 'Chamada recebida'}
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
                {isVideoCall ? (
                  <div className="softphone-video">
                    <div ref={remoteVideoRef} className="softphone-video-grid" />
                    {(remoteVideoFrames === 0 || peerVideoOff) && (
                      <div className="softphone-video-placeholder">
                        {peerVideoOff && !activeCall.isGroup ? 'Câmera do contato desligada' : 'Aguardando vídeo…'}
                      </div>
                    )}
                    <video
                      ref={localVideoElRef}
                      className={`softphone-video-local ${cameraOn ? '' : 'off'}`}
                      muted
                      playsInline
                      autoPlay
                    />
                  </div>
                ) : (
                  <div className={`softphone-avatar ${phase === 'active' ? 'active' : ''}`}>☎</div>
                )}
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
                {upgradeAsked && (
                  <div className="softphone-upgrade-prompt">
                    <span>O contato quer ligar o vídeo</span>
                    <button type="button" className="btn primary" onClick={() => void answerUpgrade(true)}>
                      Aceitar
                    </button>
                    <button type="button" className="btn ghost" onClick={() => void answerUpgrade(false)}>
                      Recusar
                    </button>
                  </div>
                )}
                <div className="softphone-call-actions">
                  <button type="button" className={`btn ghost round ${muted ? 'muted-on' : ''}`} onClick={toggleMute}>
                    {muted ? 'Unmute' : 'Mute'}
                  </button>
                  {isVideoCall && (
                    <button
                      type="button"
                      className={`btn ghost round ${cameraOn ? '' : 'muted-on'}`}
                      onClick={toggleCamera}
                    >
                      {cameraOn ? 'Câmera off' : 'Câmera on'}
                    </button>
                  )}
                  {isVideoCall && cameras.length > 1 && !screenSharing && (
                    <button
                      type="button"
                      className="btn ghost round"
                      title="Usar a próxima câmera"
                      onClick={() => void switchCamera()}
                    >
                      Trocar câmera
                    </button>
                  )}
                  {isVideoCall && phase === 'active' && 'getDisplayMedia' in (navigator.mediaDevices ?? {}) && (
                    <button
                      type="button"
                      className={`btn ghost round ${screenSharing ? 'muted-on' : ''}`}
                      disabled={screenPicking}
                      onClick={() => void toggleScreenShare()}
                    >
                      {screenSharing ? 'Parar tela' : 'Tela'}
                    </button>
                  )}
                  {!isVideoCall && phase === 'active' && isVideoCallSupported() && (
                    <button
                      type="button"
                      className="btn ghost round"
                      disabled={busy}
                      onClick={() => void upgradeToVideo()}
                    >
                      Vídeo
                    </button>
                  )}
                  <button type="button" className="btn danger round" onClick={() => void hangup()}>
                    Desligar
                  </button>
                </div>
                {isVideoCall && outboundStats && (
                  <p className={`softphone-video-status ${outboundStats.lastError ? 'error' : ''}`}>
                    {outboundStats.lastError
                      ? `Vídeo de saída: ${outboundStats.lastError}`
                      : outboundStats.source === 'none'
                        ? 'Vídeo de saída: sem câmera'
                        : `Enviando ${outboundStats.source === 'screen' ? 'tela' : (outboundStats.cameraLabel ?? 'câmera')} · ${outboundStats.framesSent} frames`}
                  </p>
                )}
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
                  onClick={() => void placeCall(false)}
                >
                  Ligar
                </button>
                <button
                  type="button"
                  className="btn ghost call-btn"
                  disabled={busy || phone.length < 8 || !isVideoCallSupported()}
                  title={isVideoCallSupported() ? 'Chamada de vídeo (H.264)' : 'Navegador sem WebCodecs'}
                  onClick={() => void placeCall(true)}
                >
                  Vídeo
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

              <div className="softphone-field">
                <span>Câmera (chamadas de vídeo)</span>
                <select
                  value={audioPrefs.cameraId}
                  onChange={(e) => {
                    updatePrefs({ cameraId: e.target.value })
                    if (cameraTest.running) stopCameraTest()
                  }}
                >
                  <option value="">Padrão do navegador</option>
                  {cameras.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <div className="softphone-camera-test">
                  <video
                    ref={cameraTestVideoRef}
                    muted
                    playsInline
                    autoPlay
                    className={cameraTest.running ? '' : 'idle'}
                  />
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={cameraTest.running && cameraTest.info === 'Abrindo câmera…'}
                    onClick={() => (cameraTest.running ? stopCameraTest() : void runCameraTest())}
                  >
                    {cameraTest.running ? 'Parar teste' : 'Testar câmera'}
                  </button>
                </div>
                {cameraTest.info && <span className="softphone-hint">{cameraTest.info}</span>}
                {cameraTest.error && <span className="softphone-hint error">{cameraTest.error}</span>}
                {!isVideoCallSupported() && (
                  <span className="softphone-hint error">Sem WebCodecs neste navegador — use Chrome ou Edge.</span>
                )}
              </div>

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
