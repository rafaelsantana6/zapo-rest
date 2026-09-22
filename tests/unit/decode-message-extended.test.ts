import { describe, expect, it } from 'vitest'
import { decodeIncomingMessage, previewFromDecoded } from '~/events/decode-message'

describe('decodeIncomingMessage — message types', () => {
  const key = { id: 'X1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false }

  it('extendedText, reaction, location, poll, contact, sticker, audio, document, video', () => {
    expect(
      decodeIncomingMessage({
        key,
        message: { extendedTextMessage: { text: 'ext' } },
      })?.type,
    ).toBe('text')

    expect(
      decodeIncomingMessage({
        key: { ...key, id: 'R' },
        message: { reactionMessage: { text: '👍' } },
      })?.body,
    ).toBe('👍')

    const loc = decodeIncomingMessage({
      key: { ...key, id: 'L' },
      message: {
        locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6, name: 'SP' },
      },
    })
    expect(loc?.type).toBe('location')
    expect(loc?.body).toContain('SP')
    expect(loc?.body).toContain('-23.5')

    expect(
      decodeIncomingMessage({
        key: { ...key, id: 'P' },
        message: { pollCreationMessage: { name: 'q' } },
      })?.type,
    ).toBe('poll')

    expect(
      decodeIncomingMessage({
        key: { ...key, id: 'C' },
        message: { contactMessage: { vcard: 'BEGIN:VCARD' } },
      })?.type,
    ).toBe('contact')

    expect(
      decodeIncomingMessage({
        key: { ...key, id: 'S' },
        message: { stickerMessage: { mimetype: 'image/webp' } },
      })?.type,
    ).toBe('sticker')

    expect(
      decodeIncomingMessage({
        key: { ...key, id: 'A' },
        message: { audioMessage: { mimetype: 'audio/ogg' } },
      })?.hasMedia,
    ).toBe(true)

    const doc = decodeIncomingMessage({
      key: { ...key, id: 'D' },
      message: {
        documentMessage: {
          mimetype: 'application/pdf',
          fileName: 'a.pdf',
          url: 'https://mmg.whatsapp.net/d.pdf',
        },
      },
    })
    expect(doc?.type).toBe('document')
    expect(doc?.mediaFilename).toBe('a.pdf')
    expect(doc?.mediaDirectUrl).toContain('mmg.whatsapp.net')

    expect(
      decodeIncomingMessage({
        key: { ...key, id: 'V' },
        message: { videoMessage: { mimetype: 'video/mp4', caption: 'vid' } },
      })?.caption,
    ).toBe('vid')
  })

  it('protocol revoke/edit types and group jid', () => {
    expect(
      decodeIncomingMessage({
        key: { id: 'PR', remoteJid: '120363@g.us', fromMe: true, participant: '5511@s.whatsapp.net' },
        message: { protocolMessage: { type: 'REVOKE', key: { id: 'OLD' } } },
      }),
    ).toMatchObject({ type: 'revoke', chatJid: '120363@g.us', participantJid: '5511@s.whatsapp.net' })

    expect(
      decodeIncomingMessage({
        key: { id: 'PE', remoteJid: 'x@s.whatsapp.net', fromMe: true },
        message: {
          protocolMessage: {
            type: 14,
            editedMessage: { conversation: 'new' },
          },
        },
      })?.type,
    ).toBe('edit')
  })

  it('timestamp ms vs seconds and preview helpers', () => {
    const ms = decodeIncomingMessage({
      key,
      message: { conversation: 'a'.repeat(250) },
      messageTimestamp: 1_700_000_000_123,
    })
    expect(ms?.timestampMs).toBe(1_700_000_000_123)
    expect(ms && previewFromDecoded(ms).length).toBe(200)

    const sec = decodeIncomingMessage({
      key: { ...key, id: 'T2' },
      message: { conversation: 'hi' },
      messageTimestamp: 1_700_000_000,
    })
    expect(sec?.timestampMs).toBe(1_700_000_000_000)

    const img = decodeIncomingMessage({
      key: { ...key, id: 'IMG' },
      message: { imageMessage: { mimetype: 'image/jpeg' } },
    })
    expect(img && previewFromDecoded(img)).toBe('[image]')

    const rev = decodeIncomingMessage({
      key: { ...key, id: 'REV' },
      message: { protocolMessage: { type: 0 } },
    })
    expect(rev && previewFromDecoded(rev)).toBe('')
  })

  it('reads AI rich-response text and keeps bot-forwarded media typed', () => {
    const rich = decodeIncomingMessage({
      key: { ...key, id: 'AI1' },
      message: {
        richResponseMessage: {
          submessages: [
            { messageText: 'Olá' },
            { messageText: 'mundo' },
            { imageMetadata: { imageText: 'legenda' } },
            { codeMetadata: { codeBlocks: [{ codeContent: 'const x = 1' }] } },
          ],
        },
      },
    })
    expect(rich?.type).toBe('text')
    expect(rich?.body).toBe('Olá\nmundo\nlegenda\nconst x = 1')
    expect(rich && previewFromDecoded(rich)).toContain('Olá')

    const forwardedImage = decodeIncomingMessage({
      key: { ...key, id: 'FWD' },
      message: {
        botForwardedMessage: {
          message: {
            imageMessage: {
              mimetype: 'image/jpeg',
              caption: 'foto',
              url: 'https://mmg.whatsapp.net/fwd.jpg',
            },
          },
        },
      },
    })
    expect(forwardedImage).toMatchObject({
      type: 'image',
      hasMedia: true,
      caption: 'foto',
      mediaMime: 'image/jpeg',
    })
    expect(forwardedImage?.mediaDirectUrl).toContain('mmg.whatsapp.net')

    const forwardedText = decodeIncomingMessage({
      key: { ...key, id: 'FWDT' },
      message: { botForwardedMessage: { message: { conversation: 'encaminhada' } } },
    })
    expect(forwardedText).toMatchObject({ type: 'text', body: 'encaminhada' })

    const bare = decodeIncomingMessage({
      key: { ...key, id: 'BARE' },
      message: { botForwardedMessage: {} },
    })
    expect(bare?.type).toBe('text')
    expect(bare?.body).toBeNull()
  })

  it('unwraps ephemeral text and captioned documents', () => {
    expect(
      decodeIncomingMessage({
        key: { ...key, id: 'EPH' },
        message: { ephemeralMessage: { message: { conversation: 'some logo' } } },
      }),
    ).toMatchObject({ type: 'text', body: 'some logo' })

    expect(
      decodeIncomingMessage({
        key: { ...key, id: 'DOCCAP' },
        message: {
          documentWithCaptionMessage: {
            message: {
              documentMessage: { mimetype: 'application/pdf', fileName: 'a.pdf', caption: 'doc' },
            },
          },
        },
      }),
    ).toMatchObject({ type: 'document', mediaFilename: 'a.pdf', caption: 'doc', hasMedia: true })
  })

  it('keeps sender and recipient handles', () => {
    const decoded = decodeIncomingMessage({
      key: {
        ...key,
        id: 'UN',
        senderUsername: '@Loja',
        recipientUsername: 'peer',
      },
      message: { conversation: 'oi' },
    })
    expect(decoded?.senderUsername).toBe('Loja')
    expect(decoded?.recipientUsername).toBe('peer')
  })

  it('strips rawNode/messageBytes from raw', () => {
    const decoded = decodeIncomingMessage({
      key,
      message: { conversation: 'x' },
      rawNode: { huge: true },
      messageBytes: Buffer.from('abc'),
    })
    const raw = decoded?.raw as Record<string, unknown>
    expect(raw.rawNode).toBeUndefined()
    expect(raw.messageBytes).toBeUndefined()
  })
})
