import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  connectInstance,
  createWebhook,
  deleteWebhook,
  disconnectInstance,
  getInstance,
  getQr,
  type Instance,
  listWebhooks,
  restartInstance,
  sendText,
  type WebhookConfig,
} from '../api/client'
import { ChatPanel } from './Chat'

type Session = { role: 'admin' } | { role: 'instance'; instance: Instance }

type Props = {
  session: Session
  onLogout: () => void
}

type Tab = 'overview' | 'chat' | 'send' | 'webhooks'

export function InstanceDetailPage({ session, onLogout }: Props) {
  const { name = '' } = useParams()
  const [instance, setInstance] = useState<Instance | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')

  // send tester
  const [to, setTo] = useState('')
  const [text, setText] = useState('')
  const [sendResult, setSendResult] = useState<string | null>(null)

  // webhooks
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [whUrl, setWhUrl] = useState('')
  const [whEvents, setWhEvents] = useState('message,instance.connection')
  const [whHmac, setWhHmac] = useState('')

  const allowed = session.role === 'admin' || (session.role === 'instance' && session.instance.name === name)

  const refresh = useCallback(async () => {
    if (!name || !allowed) return
    try {
      const { instance: row } = await getInstance(name)
      setInstance(row)
      const q = await getQr(name)
      setQr(q.qr)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
  }, [name, allowed])

  const refreshWebhooks = useCallback(async () => {
    if (!name || !allowed) return
    try {
      const res = await listWebhooks(name)
      setWebhooks(res.webhooks)
      setEvents(res.availableEvents)
    } catch {
      // ignore if endpoint not available
    }
  }, [name, allowed])

  useEffect(() => {
    void refresh
    const t = setInterval(() => void refresh, 3000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (tab === 'webhooks') void refreshWebhooks
  }, [tab, refreshWebhooks])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action
      await refresh
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleSendTest(e: React.FormEvent) {
    e.preventDefault
    if (!name || !to || !text) return
    setBusy(true)
    setSendResult(null)
    try {
      const res = await sendText(name, to, text)
      setSendResult(`Sent id=${res.id}`)
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleAddWebhook(e: React.FormEvent) {
    e.preventDefault
    if (!name || !whUrl) return
    setBusy(true)
    try {
      await createWebhook(name, {
        url: whUrl,
        events: whEvents
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        hmac: whHmac ? { key: whHmac } : undefined,
        enabled: true,
      })
      setWhUrl('')
      setWhHmac('')
      await refreshWebhooks
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Webhook create failed')
    } finally {
      setBusy(false)
    }
  }

  if (!allowed) {
    return (
      <div className="shell">
        <p className="error">Forbidden — this API key cannot access “{name}”.</p>
        <button type="button" onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  return (
    <div className={`shell ${tab === 'chat' ? 'shell-wide' : ''}`}>
      <div className="topbar">
        <div className="row">
          {session.role === 'admin' && (
            <Link to="/instances" className="muted">
              ← instances
            </Link>
          )}
          <div className="logo">
            {name} {instance && <span className={`badge ${instance.status}`}>{instance.status}</span>}
          </div>
        </div>
        <button type="button" onClick={onLogout}>
          Logout
        </button>
      </div>

      <nav className="tabs">
        {(['overview', 'chat', 'send', 'webhooks'] as Tab[]).map((t) => (
          <button key={t} type="button" className={tab === t ? 'primary' : ''} onClick={() => setTab(t)}>
            {t === 'overview' && 'Overview'}
            {t === 'chat' && 'Live chat'}
            {t === 'send' && 'Send test'}
            {t === 'webhooks' && 'Webhooks'}
          </button>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}

      {!instance ? (
        <p className="muted">Loading…</p>
      ) : tab === 'overview' ? (
        <div className="stack" style={{ gap: '1.25rem' }}>
          <section className="card stack">
            <h2>Actions</h2>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void run(() => connectInstance(name))}
              >
                Connect
              </button>
              <button type="button" disabled={busy} onClick={() => void run(() => disconnectInstance(name))}>
                Disconnect
              </button>
              <button type="button" disabled={busy} onClick={() => void run(() => restartInstance(name))}>
                Restart
              </button>
            </div>
          </section>

          {(instance.status === 'qr' || instance.status === 'connecting' || Boolean(qr)) && (
            <section className="card stack">
              <h2>QR code</h2>
              {qr ? (
                <div className="qr-box">
                  <QRCodeSVG value={qr} size={220} level="M" includeMargin />
                </div>
              ) : (
                <p className="muted">Waiting for QR…</p>
              )}
            </section>
          )}

          <section className="card stack">
            <h2>Instance</h2>
            <dl className="meta">
              <div>
                <dt>Status</dt>
                <dd>{instance.status}</dd>
              </div>
              <div>
                <dt>meJid</dt>
                <dd className="mono">{instance.meJid ?? '—'}</dd>
              </div>
              <div>
                <dt>API key</dt>
                <dd className="mono">{instance.apiKey ?? '— (só no create/rotate)'}</dd>
              </div>
              <div>
                <dt>Legacy webhook</dt>
                <dd className="mono">{instance.webhookUrl ?? '—'}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{new Date(instance.createdAt).toLocaleString}</dd>
              </div>
            </dl>
          </section>
        </div>
      ) : tab === 'chat' ? (
        <ChatPanel instanceName={name} />
      ) : tab === 'send' ? (
        <section className="card stack">
          <h2>Send test message</h2>
          <p className="muted">Quick smoke test for text delivery (requires status open).</p>
          <form className="stack" onSubmit={(e) => void handleSendTest(e)}>
            <label>
              To (phone or JID)
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="5511999999999" />
            </label>
            <label>
              Text
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Hello from zapo-rest" />
            </label>
            <button type="submit" className="primary" disabled={busy || !to || !text}>
              Send text
            </button>
          </form>
          {sendResult && <p className="ok">{sendResult}</p>}
        </section>
      ) : (
        <div className="stack" style={{ gap: '1.25rem' }}>
          <section className="card stack">
            <h2>Webhook configs</h2>
            <p className="muted">
              multi-config multi-webhook: URL + event filter + optional HMAC + retries. Events:{' '}
              {events.slice(0, 8).join(', ')}
              {events.length > 8 ? '…' : ''}
            </p>
            <form className="stack" onSubmit={(e) => void handleAddWebhook(e)}>
              <label>
                URL
                <input value={whUrl} onChange={(e) => setWhUrl(e.target.value)} placeholder="https://webhook.site/…" />
              </label>
              <label>
                Events (comma-separated, empty = all)
                <input value={whEvents} onChange={(e) => setWhEvents(e.target.value)} />
              </label>
              <label>
                HMAC key (optional)
                <input value={whHmac} onChange={(e) => setWhHmac(e.target.value)} placeholder="secret" />
              </label>
              <button type="submit" className="primary" disabled={busy || !whUrl}>
                Add webhook
              </button>
            </form>
          </section>

          <section className="card stack">
            <h2>Configured ({webhooks.length})</h2>
            {webhooks.length === 0 && <p className="muted">No webhooks yet.</p>}
            {webhooks.map((w) => (
              <div key={w.id} className="webhook-row">
                <div>
                  <div className="mono">{w.url}</div>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>
                    events: {w.events.length ? w.events.join(', ') : '*'} · {w.enabled ? 'enabled' : 'disabled'} ·
                    retries {w.retries.policy}/{w.retries.attempts}
                    {w.hmac ? ' · hmac' : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await deleteWebhook(name, w.id)
                      await refreshWebhooks
                    })
                  }
                >
                  Delete
                </button>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  )
}
