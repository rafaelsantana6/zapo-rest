import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  type CallHistoryItem,
  callDisplayJid,
  downloadCallRecording,
  getCallRecordingSettings,
  getStoredKey,
  type LiveCall,
  listCallHistory,
  setCallRecording,
  shortPhone,
} from '../../api/client'
import { ErrorBox, Shell } from '../../components/Shell'
import { type VoipConnectionState, voipSocket } from '../../voip/voip-socket'

type Props = { onLogout: () => void }

export function CallsPage({ onLogout }: Props) {
  const { name = '' } = useParams()
  const [live, setLive] = useState<LiveCall[]>([])
  const [history, setHistory] = useState<CallHistoryItem[]>([])
  const [recEnabled, setRecEnabled] = useState(false)
  const [storageReady, setStorageReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [voipConn, setVoipConn] = useState<VoipConnectionState>('disconnected')

  const loadHistoryAndSettings = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([listCallHistory(name, { limit: 50 }), getCallRecordingSettings(name)])
      setHistory(h.calls ?? [])
      setRecEnabled(s.callRecordingEnabled)
      setStorageReady(s.storageReady)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha')
    }
  }, [name])

  // VoIP control WS — live calls without polling
  useEffect(() => {
    if (!name || !getStoredKey()) return

    const upsert = (call: LiveCall) => {
      setLive((prev) => {
        const i = prev.findIndex((c) => c.callId?.toLowerCase() === call.callId?.toLowerCase())
        if (call.isEnded) {
          if (i < 0) return prev
          return prev.filter((_, idx) => idx !== i)
        }
        if (i >= 0) {
          const next = [...prev]
          next[i] = { ...next[i], ...call }
          return next
        }
        return [call, ...prev]
      })
    }

    const unsub = voipSocket.subscribe({
      onConnection: setVoipConn,
      onCallsSnapshot: (calls) => setLive(calls.filter((c) => !c.isEnded)),
      onCallOffer: upsert,
      onCallRinging: upsert,
      onCallAccepted: upsert,
      onCallState: upsert,
      onCallEnded: (call) => {
        setLive((prev) => prev.filter((c) => c.callId?.toLowerCase() !== call.callId?.toLowerCase()))
        void loadHistoryAndSettings()
      },
      onError: (m) => setError(m),
    })
    voipSocket.acquire(name)

    return () => {
      unsub()
      voipSocket.release()
    }
  }, [name, loadHistoryAndSettings])

  useEffect(() => {
    void loadHistoryAndSettings()
  }, [loadHistoryAndSettings])

  async function reject(id: string) {
    setBusy(true)
    try {
      const r = await voipSocket.rejectCall(id)
      if (!r.ok) throw new Error(r.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha')
    } finally {
      setBusy(false)
    }
  }

  async function toggleRec(enabled: boolean) {
    setBusy(true)
    try {
      const r = await setCallRecording(name, enabled)
      setRecEnabled(r.callRecordingEnabled)
      setStorageReady(r.storageReady)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      title="Chamadas VoIP"
      subtitle="Ativas via WebSocket de controle (/v1/voip) — sem polling."
      instanceName={name}
      onLogout={onLogout}
      actions={
        <Link to={`/instances/${encodeURIComponent(name)}`} className="btn ghost">
          ← Hub
        </Link>
      }
    >
      <ErrorBox error={error} />

      <div className="row-actions" style={{ marginBottom: 12 }}>
        <span className={`live-pill ${voipConn === 'connected' ? 'on' : ''}`}>
          {voipConn === 'connected' ? '● VoIP WS' : voipConn === 'connecting' ? '◌ conectando…' : '○ offline'}
        </span>
        <button type="button" className="btn ghost" onClick={() => void loadHistoryAndSettings()}>
          Atualizar histórico
        </button>
      </div>

      <div className="panel stack-form" style={{ marginBottom: 16 }}>
        <h3>Gravação de chamadas</h3>
        <p className="muted">
          Storage: {storageReady ? 'configurado' : 'não pronto'}. Use o softphone (FAB) para capturar a perna local.
        </p>
        <label className="softphone-toggle">
          <input
            type="checkbox"
            checked={recEnabled}
            disabled={busy || (!storageReady && !recEnabled)}
            onChange={(e) => void toggleRec(e.target.checked)}
          />
          Ativar gravação nesta instância
        </label>
      </div>

      <div className="panel-grid">
        <section className="panel">
          <h3>Ativas / ringing (push)</h3>
          {live.length === 0 && <p className="muted">Nenhuma</p>}
          <ul className="plain-list">
            {live.map((c) => (
              <li key={c.callId}>
                <code>{shortPhone(callDisplayJid(c) ?? c.peerJid)}</code> · {c.state} · {c.direction}
                {c.canAccept && (
                  <button
                    type="button"
                    className="btn danger"
                    style={{ marginLeft: 8 }}
                    disabled={busy}
                    onClick={() => void reject(c.callId)}
                  >
                    Reject
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h3>Histórico</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Peer</th>
                <th>Dir</th>
                <th>Duração</th>
                <th>Rec</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((c) => (
                <tr key={c.callId}>
                  <td>{shortPhone(callDisplayJid(c) ?? c.peerJid)}</td>
                  <td>{c.direction}</td>
                  <td>{c.durationSecs ?? '—'}s</td>
                  <td>{c.recording.status}</td>
                  <td>
                    {c.recording.status === 'ready' && c.recording.downloadPath && (
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={async () => {
                          setError(null)
                          try {
                            await downloadCallRecording(name, c.callId)
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Falha ao baixar a gravação')
                          }
                        }}
                      >
                        Download
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Vazio
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </Shell>
  )
}
