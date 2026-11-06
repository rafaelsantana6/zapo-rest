import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

type Prefs = typeof prefs
type Audio = {
  ready(): Promise<void>
  setMicrophone(prefs: Prefs): Promise<void>
  setOutput(id: string): Promise<void>
  stop(): void
}
let RemoteCallAudio: new (sink: object, prefs: Prefs) => Audio
const fake = vi.hoisted(() => ({ start: vi.fn(), setMicrophone: vi.fn(), stopAdapter: vi.fn(async () => undefined) }))
vi.mock('../../dashboard/node_modules/@zapo-js/voip-media/dist/esm/web/index.js', () => ({
  WaWebCallAudio: { start: fake.start },
}))
beforeAll(async () => {
  const browserModule = '../../dashboard/src/voip/remote-call-audio'
  RemoteCallAudio = (await import(browserModule)).RemoteCallAudio
})
const prefs = {
  micId: 'chosen-microphone',
  speakerId: '',
  cameraId: '',
  noiseFilter: true,
  browserNoiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  micGain: 1,
}
function fakeMicrophone() {
  return {
    track: { stop: vi.fn() },
    getTracks() {
      return [this.track]
    },
  }
}
function pending<T>() {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve: (value: T) => resolve?.(value) }
}
class FakeAudioContext {
  static contexts: FakeAudioContext[] = []
  state = 'running'
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  setSinkId = vi.fn(async (_id: string): Promise<void> => undefined)
  constructor() {
    FakeAudioContext.contexts.push(this)
  }
}
let microphone = fakeMicrophone()
const acquire = vi.fn(async (_constraints: unknown) => microphone)
beforeEach(() => {
  vi.clearAllMocks()
  microphone = fakeMicrophone()
  acquire.mockResolvedValue(microphone)
  fake.start.mockResolvedValue({ stop: fake.stopAdapter, setMicrophone: fake.setMicrophone })
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: acquire } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  FakeAudioContext.contexts.length = 0
})

describe('remote audio device ownership', () => {
  it('requests the chosen microphone and resumes context inside the gesture, then passes only that stream to upstream', async () => {
    const audio = new RemoteCallAudio({}, prefs)
    const context = FakeAudioContext.contexts[0]
    expect(context?.resume).toHaveBeenCalledOnce()
    expect(acquire).toHaveBeenCalledWith({
      audio: {
        deviceId: { exact: 'chosen-microphone' },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    await audio.ready()
    expect(fake.start).toHaveBeenCalledWith({}, { microphone, audioContext: context })
    audio.stop()
    audio.stop()
    expect(microphone.track.stop).toHaveBeenCalledOnce()
    expect(context?.close).toHaveBeenCalledOnce()
    expect(fake.stopAdapter).toHaveBeenCalledOnce()
  })
  it('releases a permission result arriving after hangup', async () => {
    const permission = pending<ReturnType<typeof fakeMicrophone>>()
    acquire.mockReturnValueOnce(permission.promise)
    const audio = new RemoteCallAudio({}, prefs)
    const ready = audio.ready().catch((error: unknown) => error)
    audio.stop()
    permission.resolve(microphone)
    expect(await ready).toBeInstanceOf(Error)
    expect(microphone.track.stop).toHaveBeenCalledOnce()
    expect(fake.start).not.toHaveBeenCalled()
  })
  it('releases a late adapter and its microphone after hangup', async () => {
    const adapter = pending<{ stop: typeof fake.stopAdapter; setMicrophone: typeof fake.setMicrophone }>()
    fake.start.mockReturnValueOnce(adapter.promise)
    const audio = new RemoteCallAudio({}, prefs)
    const ready = audio.ready().catch((error: unknown) => error)
    await vi.waitFor(() => expect(fake.start).toHaveBeenCalled())
    audio.stop()
    adapter.resolve({ stop: fake.stopAdapter, setMicrophone: fake.setMicrophone })
    expect(await ready).toBeInstanceOf(Error)
    expect(microphone.track.stop).toHaveBeenCalledOnce()
    expect(fake.stopAdapter).toHaveBeenCalledOnce()
  })
  it('switches microphone and stops the previous owned input', async () => {
    const audio = new RemoteCallAudio({}, prefs)
    await audio.ready()
    const replacement = fakeMicrophone()
    acquire.mockResolvedValueOnce(replacement)
    await audio.setMicrophone({ ...prefs, micId: 'replacement' })
    expect(fake.setMicrophone).toHaveBeenCalledWith(replacement)
    expect(microphone.track.stop).toHaveBeenCalledOnce()
    audio.stop()
    expect(replacement.track.stop).toHaveBeenCalledOnce()
  })
  it('keeps the active microphone if a replacement cannot attach', async () => {
    const audio = new RemoteCallAudio({}, prefs)
    await audio.ready()
    const rejected = fakeMicrophone()
    acquire.mockResolvedValueOnce(rejected)
    fake.setMicrophone.mockImplementationOnce(() => {
      throw new Error('Cannot attach')
    })
    await expect(audio.setMicrophone({ ...prefs, micId: 'unavailable' })).rejects.toThrow('Cannot attach')
    expect(rejected.track.stop).toHaveBeenCalledOnce()
    expect(microphone.track.stop).not.toHaveBeenCalled()
    audio.stop()
  })
  it('serializes output changes and can retry after an output rejection', async () => {
    const audio = new RemoteCallAudio({}, prefs)
    await audio.ready()
    const context = FakeAudioContext.contexts[0]
    if (!context) throw new Error('No audio context')
    context.setSinkId.mockClear()
    const first = pending<void>()
    context.setSinkId.mockReturnValueOnce(first.promise)
    const switchingFirst = audio.setOutput('speaker-1')
    const switchingSecond = audio.setOutput('speaker-2')
    await vi.waitFor(() => expect(context.setSinkId).toHaveBeenCalledWith('speaker-1'))
    expect(context.setSinkId).not.toHaveBeenCalledWith('speaker-2')
    first.resolve()
    await Promise.all([switchingFirst, switchingSecond])
    expect(context.setSinkId.mock.calls.map(([id]) => id)).toEqual(['speaker-1', 'speaker-2'])
    context.setSinkId.mockRejectedValueOnce(new Error('Output denied'))
    await expect(audio.setOutput('denied')).rejects.toThrow('Output denied')
    await audio.setOutput('working')
    audio.stop()
  })
})
