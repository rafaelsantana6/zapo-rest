import { describe, expect, it } from 'vitest'
import { asPhoneJid, pickDisplayPeerJid, serializeCallInfo } from '~/voip/call-serialize'

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
