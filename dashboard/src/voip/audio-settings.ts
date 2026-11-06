/** Persisted softphone audio device / processing prefs (localStorage). */

const KEY = 'zapo-softphone-audio'

export type SoftphoneAudioPrefs = {
  micId: string
  speakerId: string
  /** Video calls; empty = browser default. */
  cameraId: string
  /** Extra client-side noise gate + high-pass (on top of browser NS). */
  noiseFilter: boolean
  /** Browser constraint noiseSuppression */
  browserNoiseSuppression: boolean
  echoCancellation: boolean
  autoGainControl: boolean
  /** 0.5 – 3.0 linear gain on mic before send */
  micGain: number
}

const DEFAULTS: SoftphoneAudioPrefs = {
  micId: '',
  speakerId: '',
  cameraId: '',
  noiseFilter: true,
  browserNoiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  micGain: 1.2,
}

export function loadAudioPrefs(): SoftphoneAudioPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<SoftphoneAudioPrefs>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveAudioPrefs(prefs: SoftphoneAudioPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* private mode */
  }
}

export type MediaDeviceOption = {
  deviceId: string
  label: string
  kind: MediaDeviceKind
}

/** List inputs/outputs. Requires a prior getUserMedia grant for real labels. */
export async function listAudioDevices(): Promise<{
  mics: MediaDeviceOption[]
  speakers: MediaDeviceOption[]
  cameras: MediaDeviceOption[]
}> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { mics: [], speakers: [], cameras: [] }
  }
  const devices = await navigator.mediaDevices.enumerateDevices()
  const mics: MediaDeviceOption[] = []
  const speakers: MediaDeviceOption[] = []
  const cameras: MediaDeviceOption[] = []
  let micIdx = 0
  let spkIdx = 0
  let camIdx = 0
  for (const d of devices) {
    if (d.kind === 'audioinput') {
      micIdx++
      mics.push({
        deviceId: d.deviceId,
        label: d.label || `Microfone ${micIdx}`,
        kind: d.kind,
      })
    } else if (d.kind === 'audiooutput') {
      spkIdx++
      speakers.push({
        deviceId: d.deviceId,
        label: d.label || `Alto-falante ${spkIdx}`,
        kind: d.kind,
      })
    } else if (d.kind === 'videoinput') {
      camIdx++
      cameras.push({ deviceId: d.deviceId, label: d.label || `Câmera ${camIdx}`, kind: d.kind })
    }
  }
  return { mics, speakers, cameras }
}

/** Warm permission so enumerateDevices returns labels. */
export async function ensureMicPermission(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const t of stream.getTracks()) t.stop()
  } catch {
    /* user denied — labels stay empty */
  }
}
