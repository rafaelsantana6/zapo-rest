/**
 * FakeWaServer + a real zapo-js WaClient (with the real voip plugin) paired against it.
 * This is the "zapo" leg of the call harness — exactly what production runs, minus WhatsApp.
 */
import { voipPlugin } from '@zapo-js/voip'

// biome-ignore lint/suspicious/noExplicitAny: fake-server / zapo-js dynamic surfaces
type Any = any

export type PairedZapoClient = {
  server: Any
  pipeline: Any
  client: Any
  /** Our own device JID as the voip plugin derives SRTP keys from it. */
  selfDeviceJid: string
  stop: () => Promise<void>
}

const ZAPO_DEVICE_JID = '5511999999999:1@s.whatsapp.net'

async function waitForCreds(client: Any, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    const creds = client.getCredentials()
    if (creds?.advSecretKey && creds.registrationInfo?.identityKeyPair) {
      return {
        advSecretKey: creds.advSecretKey,
        identityPublicKey: creds.registrationInfo.identityKeyPair.pubKey,
      }
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('credentials not ready for pairing')
}

export function toDeviceJid(jid: string): string {
  return /:\d+@/.test(jid) ? jid : jid.replace('@', ':0@')
}

export async function startPairedZapoClient(): Promise<PairedZapoClient> {
  const { FakeWaServer } = await import('@zapo-js/fake-server')
  const { createNoopLogger, createStore, WaClient } = await import('zapo-js')

  const server: Any = await FakeWaServer.start()
  const client: Any = new WaClient(
    {
      store: createStore({}),
      sessionId: `call-harness-${Date.now()}`,
      chatSocketUrls: [server.url],
      testHooks: { noiseRootCa: server.noiseRootCa },
      history: { enabled: false },
      markOnlineOnConnect: false,
      // fake-server 1.3 signs pair-success with an older ADV HMAC layout than zapo-js 1.9 expects
      dangerous: { disablePairSuccessHmacVerification: true },
      // FNA relay on an ephemeral localhost port, not WhatsApp's 3480. voip 1.4 dials relays over
      // WebRTC (ICE/DTLS/SCTP) by default; the fake relay is plain UDP, so use the raw UDP transport.
      plugins: [
        voipPlugin({
          maxConcurrentCalls: 3,
          useOriginalRelayPort: true,
          useRawUdpTransport: true,
          ...(process.env.CALL_HARNESS_LOG ? { logLevel: 'trace' } : {}),
        }),
      ],
    },
    // CALL_HARNESS_LOG=1 → zapo-js default console logger (noisy, useful when a scenario breaks)
    process.env.CALL_HARNESS_LOG ? undefined : createNoopLogger(),
  )

  const connected = client.connect()
  let pipeline = await server.waitForAuthenticatedPipeline()
  await server.runPairing(pipeline, { deviceJid: ZAPO_DEVICE_JID }, () => waitForCreds(client))
  await connected
  try {
    pipeline = await server.waitForNextAuthenticatedPipeline(8_000)
  } catch {
    // some versions keep the same pipeline after pairing
  }

  const creds = client.getCredentials()
  const selfJid: string | undefined = creds?.meLid || creds?.meJid
  if (!selfJid) throw new Error('pairing did not register meJid')

  return {
    server,
    pipeline,
    client,
    selfDeviceJid: toDeviceJid(selfJid),
    stop: async () => {
      await client.disconnect().catch(() => undefined)
      await server.stop().catch(() => undefined)
    },
  }
}
