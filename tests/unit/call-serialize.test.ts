import { describe, expect, it } from 'vitest'
import { asPhoneJid, effectiveMediaType, pickDisplayPeerJid, serializeCallInfo } from '~/voip/call-serialize'

describe('asPhoneJid', () => {
  it('accepts PN JID and digits', () => {
    expect(asPhoneJid('556881159096@s.whatsapp.net')).toBe('556881159096@s.whatsapp.net')
    expect(asPhoneJid('556881159096')).toBe('556881159096@s.whatsapp.net')
  })

  it('rejects LID', () => {
    expect(asPhoneJid('123456789010287@lid')).toBeNull()
  })
})

describe('pickDisplayPeerJid', () => {
  it('prefers callerPn over LID peer', () => {
    expect(
      pickDisplayPeerJid({
        peerJid: '999888777666555@lid',
        callerPn: '556881159096',
      }),
    ).toBe('556881159096@s.whatsapp.net')
  })

  it('uses mapped PN from lid_map', () => {
    expect(
      pickDisplayPeerJid({
        peerJid: '999@lid',
        mappedPn: '556881159096@s.whatsapp.net',
      }),
    ).toBe('556881159096@s.whatsapp.net')
  })

  it('falls back to raw LID when no PN known', () => {
    expect(
      pickDisplayPeerJid({
        peerJid: '999888777666555@lid',
      }),
    ).toBe('999888777666555@lid')
  })
})

describe('serializeCallInfo', () => {
  it('exposes PN as peerJid when callerPn present', () => {
    const snap = serializeCallInfo({
      callId: 'abc',
      peerJid: '123456789010287@lid',
      callerPn: '556881159096',
      direction: 'incoming',
      stateData: { state: 'incoming_ringing', audioMuted: false },
      isActive: false,
      isRinging: true,
      isEnded: false,
      canAccept: true,
    })
    expect(snap.peerJid).toBe('556881159096@s.whatsapp.net')
    expect(snap.peerLid).toBe('123456789010287@lid')
    expect(snap.peerJidRaw).toBe('123456789010287@lid')
    expect(snap.callerPn).toBe('556881159096')
  })

  it('exposes mediaType and peer videoOff for video calls', () => {
    const snap = serializeCallInfo({
      callId: 'v1',
      peerJid: '556881159096@s.whatsapp.net',
      direction: 'outgoing',
      mediaType: 'video',
      stateData: { state: 'active', audioMuted: false, videoOff: false },
    })
    expect(snap.mediaType).toBe('video')
    expect(snap.videoOff).toBe(false)
  })
})

describe('serializeCallInfo interactions (voip 1.2)', () => {
  it('exposes peer mic, local hand and remote raised hands', () => {
    const snap = serializeCallInfo({
      callId: 'h1',
      peerJid: '5511888888888@s.whatsapp.net',
      stateData: { state: 'active', peerAudioMuted: true, handRaised: true },
      raisedHands: new Set(['5511888888888:2@s.whatsapp.net']),
    })
    expect(snap.peerAudioMuted).toBe(true)
    expect(snap.handRaised).toBe(true)
    expect(snap.raisedHands).toEqual(['5511888888888:2@s.whatsapp.net'])
  })

  it('defaults before the peer announces anything', () => {
    const snap = serializeCallInfo({ callId: 'h2', stateData: { state: 'ringing' } })
    expect(snap.peerAudioMuted).toBeNull()
    expect(snap.handRaised).toBe(false)
    expect(snap.raisedHands).toEqual([])
  })
})

describe('serializeCallInfo group calls (voip 1.4)', () => {
  it('exposes the group and its roster', () => {
    const snap = serializeCallInfo({
      callId: 'g1',
      groupJid: '120363000000000000@g.us',
      stateData: { state: 'active' },
      groupComposition: { participants: [{ jid: '111@lid', devices: ['111:2@lid'], state: 'connected' }] },
    })
    expect(snap.isGroup).toBe(true)
    expect(snap.groupJid).toBe('120363000000000000@g.us')
    expect(snap.participants).toEqual([{ jid: '111@lid', devices: ['111:2@lid'], state: 'connected' }])
  })

  it('reports a 1:1 call as not a group', () => {
    const snap = serializeCallInfo({ callId: 'p1', stateData: { state: 'active' } })
    expect(snap).toMatchObject({ isGroup: false, groupJid: null, participants: [] })
  })
})

describe('effectiveMediaType (1:1 upgrade keeps mediaType audio upstream)', () => {
  it('stays audio until video is live', () => {
    expect(effectiveMediaType({ mediaType: 'audio', stateData: { videoOff: true } })).toBe('audio')
  })

  it('turns video once our camera is announced or the peer accepted', () => {
    expect(effectiveMediaType({ mediaType: 'audio', stateData: { videoOff: false } })).toBe('video')
    expect(
      effectiveMediaType({ mediaType: 'audio', stateData: { videoOff: true }, peerVideoState: { state: 4 } }),
    ).toBe('video')
  })
})
