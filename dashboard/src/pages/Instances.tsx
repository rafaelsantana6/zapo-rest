import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  connectInstance,
  createInstance,
  deleteInstance,
  type Instance,
  listInstances,
  restoreAdminApiKey,
  setInstanceHint,
  shortPhone,
  setInstanceApiKey,
} from '../api/client'
import { Empty, ErrorBox, Shell, StatusBadge } from '../components/Shell'

type Props = { onLogout: () => void }

export function InstancesPage({ onLogout }: Props) {
  const [instances, setInstances] = useState<Instance[]>([])
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    try {
      const { instances: rows } = await listInstances()
      setInstances(rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao listar')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
  }, [refresh])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return instances
    return instances.filter(
      (i) =>
        i.name.toLowerCase().includes(s) ||
        (i.meJid ?? '').toLowerCase().includes(s) ||
        i.status.toLowerCase().includes(s),
    )
  }, [instances, q])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setBusy(true)
    try {
      const { instance } = await createInstance({ name: newName.trim() })
      setNewName('')
      setShowCreate(false)
      await refresh()
      setInstanceHint(instance.name)
      setInstanceApiKey(instance.apiKey)
      navigate(`/instances/${instance.name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar')
    } finally {
      setBusy(false)
    }
  }

  function openInstance(inst: Instance) {
    setInstanceHint(inst.name)
    setInstanceApiKey(inst.apiKey)
    navigate(`/instances/${inst.name}`)
  }

  return (
    <Shell
      title="Gerenciamento de Instâncias"
      subtitle="Monitore e configure suas conexões WhatsApp."
      onLogout={onLogout}
      actions={
        <>
          <button type="button" className="ghost" onClick={() => void refresh()} title="Atualizar">
            ↻
          </button>
          <button type="button" className="primary" onClick={() => setShowCreate(true)}>
            + Adicionar Instância
          </button>
        </>
      }
    >
      <ErrorBox error={error} />

      <div className="instances-layout">
        <aside className="panel side-panel">
          <div className="panel-head">
            <h2>Filtros</h2>
          </div>
          <button type="button" className="side-item active">
            Todas as Instâncias <span className="count">{instances.length}</span>
          </button>
          <div className="side-stats">
            <div>
              <strong>{instances.filter((i) => i.status === 'open').length}</strong>
              <span className="muted">conectadas</span>
            </div>
            <div>
              <strong>{instances.filter((i) => i.status !== 'open').length}</strong>
              <span className="muted">outras</span>
            </div>
          </div>
        </aside>

        <section className="panel">
          <div className="panel-head">
            <h2>
              Instâncias <span className="muted">({filtered.length})</span>
            </h2>
            <input className="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          {filtered.length === 0 ? (
            <Empty>Nenhuma instância. Clique em “Adicionar Instância”.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Instância</th>
                    <th>Status</th>
                    <th>Número</th>
                    <th>API Key</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inst) => (
                    <tr key={inst.name}>
                      <td>
                        <div className="inst-name">
                          <span className={`dot-lg status-${inst.status}`} />
                          <div>
                            <strong>{inst.name}</strong>
                            <div className="muted tiny mono">{inst.meJid ?? '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={inst.status} />
                      </td>
                      <td className="mono">{shortPhone(inst.meJid)}</td>
                      <td className="mono tiny">{maskKey(inst.apiKey)}</td>
                      <td>
                        <div className="row-actions">
                          {inst.status !== 'open' && (
                            <button
                              type="button"
                              className="icon-btn"
                              title="Conectar"
                              disabled={busy}
                              onClick={() =>
                                void (async () => {
                                  setBusy(true)
                                  try {
                                    setInstanceApiKey(inst.apiKey)
                                    await connectInstance(inst.name)
                                    restoreAdminApiKey()
                                    await refresh()
                                  } catch (err) {
                                    restoreAdminApiKey()
                                    setError(err instanceof Error ? err.message : 'Erro')
                                  } finally {
                                    setBusy(false)
                                  }
                                })()
                              }
                            >
                              ⌁
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-btn primary-soft"
                            title="Acessar"
                            onClick={() => openInstance(inst)}
                          >
                            →
                          </button>
                          <button
                            type="button"
                            className="icon-btn danger"
                            title="Excluir"
                            disabled={busy}
                            onClick={() =>
                              void (async () => {
                                if (!confirm(`Excluir instância “${inst.name}”?`)) return
                                setBusy(true)
                                try {
                                  await deleteInstance(inst.name)
                                  await refresh()
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : 'Erro')
                                } finally {
                                  setBusy(false)
                                }
                              })()
                            }
                          >
                            ×
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {showCreate && (
        <div className="modal-backdrop">
          <button type="button" className="modal-scrim" aria-label="Fechar" onClick={() => setShowCreate(false)} />
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-instance-title"
            onSubmit={(e) => void handleCreate(e)}
          >
            <h2 id="create-instance-title">Nova instância</h2>
            <p className="muted">Nome vira o sessionId do zapo (a-z, 0-9, _ -).</p>
            <label>
              Nome
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="sales-1"
                pattern="[a-zA-Z0-9_-]{1,64}"
                required
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setShowCreate(false)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={busy}>
                Criar
              </button>
            </div>
          </form>
        </div>
      )}
    </Shell>
  )
}

/** Mask a plaintext key when present; list/get omit apiKey so show an em dash. */
function maskKey(key: string | undefined): string {
  if (!key) return '—'
  if (key.length <= 10) return key
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}
