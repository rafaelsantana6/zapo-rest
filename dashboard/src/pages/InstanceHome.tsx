import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getInstance, type Instance } from '../api/client'
import { ErrorBox, ModuleCard, Shell } from '../components/Shell'

type Props = { onLogout: () => void }

export function InstanceHomePage({ onLogout }: Props) {
  const { name = '' } = useParams()
  const [instance, setInstance] = useState<Instance | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { instance: row } = await getInstance(name)
      setInstance(row)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar')
    }
  }, [name])

  useEffect(() => {
    void refresh
    const t = setInterval(() => void refresh, 4000)
    return () => clearInterval(t)
  }, [refresh])

  const base = `/instances/${encodeURIComponent(name)}`

  return (
    <Shell
      title="zapo Manager"
      subtitle="Gerencie conexão, chat, envios, webhooks e grupos desta instância."
      instanceName={name}
      instanceStatus={instance?.status}
      onLogout={onLogout}
      actions={
        <Link to="/instances" className="btn ghost">
          ← Instâncias
        </Link>
      }
    >
      <ErrorBox error={error} />

      <div className="back-bar">
        <Link to="/instances" className="back-link">
          ← Voltar às Instâncias
        </Link>
        <span className="muted">Gerenciar conexão · {name}</span>
      </div>

      <section className="mod-section">
        <div className="mod-section-title">Conexão & perfil</div>
        <div className="mod-grid">
          <ModuleCard
            icon="⌁"
            badge="Core"
            title="Conexão / QR"
            description="Conectar, desconectar, QR code, pairing code e API key."
            to={`${base}/connection`}
          />
          <ModuleCard
            icon="☺"
            badge="Core"
            title="Perfil"
            description="Nome de exibição, about e foto do WhatsApp."
            to={`${base}/profile`}
          />
          <ModuleCard
            icon="📊"
            badge="Analytics"
            title="Métricas"
            description="Mensagens, chamadas, mídia, storage e recursos (CPU/RAM) no tempo."
            to={`${base}/metrics`}
          />
          <ModuleCard
            icon="⚡"
            badge="Live"
            title="Eventos em tempo real"
            description="SSE de eventos (message, connection, call…) com X-Api-Key no header."
            to={`${base}/events`}
          />
        </div>
      </section>

      <section className="mod-section">
        <div className="mod-section-title">Ferramentas</div>
        <div className="mod-grid">
          <ModuleCard
            icon="💬"
            badge="Chat"
            title="Chat completo"
            description="Conversas e histórico persistido com envio em tempo real."
            to={`${base}/chat`}
          />
          <ModuleCard
            icon="✦"
            badge="Chat"
            title="Live Chat"
            description="Mini chat efêmero para testar texto/mídia com um número."
            to={`${base}/live-chat`}
          />
          <ModuleCard
            icon="✉"
            badge="Teste"
            title="Envio de mensagens"
            description="Text, imagem, áudio, documento, vídeo, poll, localização, contato."
            to={`${base}/send`}
          />
          <ModuleCard
            icon="👥"
            badge="Grupos"
            title="Gerenciador de Grupos"
            description="Listar, criar, convidar, sair e ajustar configurações."
            to={`${base}/groups`}
          />
          <ModuleCard
            icon="☎"
            badge="Contatos"
            title="Contatos"
            description="Lista de contatos sincronizados e bloqueio."
            to={`${base}/contacts`}
          />
          <ModuleCard
            icon="⌕"
            badge="Lookup"
            title="Dados do usuário"
            description="Resolver JID (nono dígito), exists, foto e about."
            to={`${base}/lookup`}
          />
        </div>
      </section>

      <section className="mod-section">
        <div className="mod-section-title">Automação</div>
        <div className="mod-grid">
          <ModuleCard
            icon="⇢"
            badge="Auto"
            title="Webhooks"
            description="Múltiplas URLs, eventos, HMAC e retries (estilo)."
            to={`${base}/webhooks`}
          />
          <ModuleCard
            icon="🏷"
            badge="Biz"
            title="Labels"
            description="Etiquetas de chat (WhatsApp Business app-state)."
            to={`${base}/labels`}
          />
          <ModuleCard
            icon="◎"
            badge="Media"
            title="Mídia"
            description="Stream por messageId + getBase64 (storage → live fallback)."
            to={`${base}/media`}
          />
          <ModuleCard
            icon="◈"
            badge="Map"
            title="LID ↔ PN"
            description="Mapa de identidade e reconcile de chats fantasmas."
            to={`${base}/lids`}
          />
        </div>
      </section>

      <section className="mod-section">
        <div className="mod-section-title">Conta & status</div>
        <div className="mod-grid">
          <ModuleCard
            icon="🔒"
            badge="Privacy"
            title="Privacidade"
            description="Last seen, online, profile, blocklist e business profile."
            to={`${base}/privacy`}
          />
          <ModuleCard
            icon="◉"
            badge="Stories"
            title="Status / Stories"
            description="Publicar e revogar status de texto ou mídia."
            to={`${base}/status`}
          />
          <ModuleCard
            icon="◉"
            badge="Live"
            title="Presence"
            description="Available/unavailable e composing/recording."
            to={`${base}/presence`}
          />
          <ModuleCard
            icon="☎"
            badge="VoIP"
            title="Chamadas"
            description="Lista e rejeição de calls (plugin VoIP)."
            to={`${base}/calls`}
          />
          <ModuleCard
            icon="⌘"
            badge="Dev"
            title="API Explorer"
            description="Presets de todos os endpoints principais com a API key da sessão."
            to={`${base}/api`}
          />
        </div>
      </section>

      {instance && (
        <div className="meta-strip">
          <div>
            <span className="muted">API Key</span>
            <code className="mono">{instance.apiKey ?? '— (só no create/rotate)'}</code>
          </div>
          <div>
            <span className="muted">meJid</span>
            <code className="mono">{instance.meJid ?? '—'}</code>
          </div>
          <div>
            <span className="muted">Atualizado</span>
            <span>{new Date(instance.updatedAt).toLocaleString}</span>
          </div>
        </div>
      )}
    </Shell>
  )
}
