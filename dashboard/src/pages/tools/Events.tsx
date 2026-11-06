import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { type EventsSseSubscription, openEventsSse } from '../../api/client'
import { ErrorBox, Shell } from '../../components/Shell'

type Props = { onLogout: () => void }
type Ev = { at: string; event: string; raw: unknown }

export function EventsPage({ onLogout }: Props) {
  const { name = '' } = useParams()
  const [live, setLive] = useState(false)
  const [events, setEvents] = useState<Ev[]>([])
  const [filter, setFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let es: EventsSseSubscription | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (closed) return
      try {
        es = openEventsSse(name)
        // Auth via X-Api-Key header (fetch stream) — key never in the URL
        es.onopen = () => {
          setLive(true)
          setError(null)
        }
        es.onerror = () => {
          setLive(false)
          es?.close()
          if (!closed) {
            setError('SSE desconectado — reconectando…')
            retry = setTimeout(connect, 2000)
          }
        }
        es.onmessage = (msg) => {
          if (pausedRef.current) return
          try {
            const data = JSON.parse(String(msg.data)) as { event?: string }
            setEvents((prev) =>
              [
                ...prev,
                {
                  at: new Date().toISOString(),
                  event: data.event ?? 'unknown',
                  raw: data,
                },
              ].slice(-300),
            )
          } catch {
            // ignore non-JSON / comments
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'SSE error')
        if (!closed) retry = setTimeout(connect, 3000)
      }
    }
    connect()
    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      es?.close()
    }
  }, [name])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const filtered = filter
    ? events.filter((e) => e.event.includes(filter) || JSON.stringify(e.raw).includes(filter))
    : events

  return (
    <Shell
      title="Eventos em tempo real"
      subtitle="SSE GET /v1/events (X-Api-Key no header) — espelho dos webhooks, server → client."
      instanceName={name}
      onLogout={onLogout}
      actions={
        <>
          <span className={`live-pill ${live ? 'on' : ''}`}>{live ? '● conectado' : '○ offline'}</span>
          <button type="button" className="ghost" onClick={() => setPaused((p) => !p)}>
            {paused ? 'Retomar' : 'Pausar'}
          </button>
          <button type="button" className="ghost" onClick={() => setEvents([])}>
            Limpar
          </button>
          <Link to={`/instances/${name}`} className="btn ghost">
            ← Hub
          </Link>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="panel stack">
        <p className="muted tiny" style={{ margin: 0 }}>
          Canal unidirecional (SSE). VoIP continua em WebSocket (<code>/v1/voip</code> + stream PCM).
        </p>
        <p className="muted tiny">
          Canais: <code>newsletter.update</code> e <code>newsletter.message_update</code> também chegam neste fluxo. Use{' '}
          <code>POST /v1/newsletters/:jid/live-updates</code> e renove conforme <code>durationSeconds</code>.
        </p>
        <input
          className="search"
          placeholder="Filtrar evento ou payload…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="events-stream">
          {filtered.length === 0 && <p className="muted">Aguardando eventos…</p>}
          {filtered.map((e) => (
            <details key={`${e.at}-${e.event}-${JSON.stringify(e.raw).slice(0, 48)}`} className="event-row">
              <summary>
                <span className="event-name">{e.event}</span>
                <span className="muted tiny">{e.at}</span>
              </summary>
              <pre className="code-block">{JSON.stringify(e.raw, null, 2)}</pre>
            </details>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </Shell>
  )
}
