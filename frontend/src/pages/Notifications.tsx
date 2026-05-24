import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Notification } from '../api/client'
import { useNotifications } from '../notifications/NotificationsContext'
import { formatDate } from '../lib/format'
import Avatar from '../components/Avatar'

// /notificacoes: lista as últimas 50 notificações do usuário.
// Marcar todas como lidas é ação única explícita (botão no topo).
//
// Render unificado por tipo: cada Notification gera uma frase
// curta + link pro asset/perfil envolvido. Tipos novos no futuro
// adicionam um case no switch.
export default function Notifications() {
  const { refresh, markAllRead } = useNotifications()
  const [notifs, setNotifs] = useState<Notification[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [markingRead, setMarkingRead] = useState(false)

  const load = useCallback(() => {
    let cancelled = false
    setError(null)
    setNotifs(null)
    api
      .get<Notification[]>('/api/v1/my/notifications')
      .then((data) => {
        if (!cancelled) setNotifs(data)
      })
      .catch(() => {
        if (!cancelled) setError('Falha ao carregar notificações.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = load()
    return cancel
  }, [load])

  const unreadInList = useMemo(
    () => notifs?.filter((n) => !n.read_at).length ?? 0,
    [notifs],
  )

  async function handleMarkAll() {
    setMarkingRead(true)
    try {
      await markAllRead()
      // Otimismo local: marca tudo na lista carregada também.
      setNotifs((prev) =>
        prev ? prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) : prev,
      )
      void refresh()
    } finally {
      setMarkingRead(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="bg-parchment border-4 border-ink shadow-pixel">
        <p className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
          ▶ Notificações
        </p>
        <div className="px-6 py-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
              Últimos avisos
            </h1>
            <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
              ▸ {subtitle(notifs, error)}
            </p>
          </div>
          {unreadInList > 0 && (
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={markingRead}
              className="
                bg-ink text-parchment border-4 border-ink shadow-pixel
                px-4 py-2 text-xs font-bold uppercase tracking-widest
                transition-all duration-75 ease-out
                hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
                disabled:opacity-50
              "
            >
              ▶ Marcar todas como lidas
            </button>
          )}
        </div>
      </header>

      <Content notifs={notifs} error={error} onRetry={load} />
    </div>
  )
}

function subtitle(notifs: Notification[] | null, error: string | null): string {
  if (error) return 'Falha ao carregar'
  if (notifs === null) return 'Carregando...'
  if (notifs.length === 0) return 'Nenhuma notificação ainda'
  const unread = notifs.filter((n) => !n.read_at).length
  if (unread === 0) return `${notifs.length} notificações · todas lidas`
  return `${notifs.length} notificações · ${unread} não ${unread === 1 ? 'lida' : 'lidas'}`
}

function Content({
  notifs,
  error,
  onRetry,
}: {
  notifs: Notification[] | null
  error: string | null
  onRetry: () => void
}) {
  if (error) {
    return (
      <div className="bg-ink text-parchment border-4 border-ink shadow-pixel p-8 text-center">
        <p className="text-sm font-bold uppercase tracking-widest mb-6">
          {error}
        </p>
        <button
          onClick={onRetry}
          className="bg-parchment text-ink border-4 border-ink shadow-pixel px-4 py-2 text-xs font-bold uppercase tracking-widest hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-75 ease-out"
        >
          ▶ Tentar novamente
        </button>
      </div>
    )
  }
  if (notifs === null) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-8 text-center animate-pulse">
        <p className="text-sm font-bold uppercase tracking-widest">
          ▌ Carregando...
        </p>
      </div>
    )
  }
  if (notifs.length === 0) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center">
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Sem notificações ainda
        </p>
        <p className="text-xs text-ink/70 tracking-wider">
          Quando alguém comprar ou avaliar seus assets, aparece aqui.
        </p>
      </div>
    )
  }
  return (
    <ul className="space-y-2">
      {notifs.map((n) => (
        <NotificationItem key={n.id} notif={n} />
      ))}
    </ul>
  )
}

// NotificationItem: 1 linha com avatar do actor, texto descritivo e
// timestamp. Background levemente destacado quando não-lida (bg-arcane/10).
function NotificationItem({ notif }: { notif: Notification }) {
  const unread = !notif.read_at
  return (
    <li
      className={`
        border-4 border-ink shadow-pixel-sm px-3 py-3 flex items-start gap-3
        ${unread ? 'bg-arcane/10' : 'bg-parchment'}
      `}
    >
      <Avatar
        avatarPath={notif.actor_avatar_path}
        name={notif.actor_display_name ?? '?'}
        size="sm"
      />
      <div className="flex-1 min-w-0 text-xs leading-relaxed">
        <NotificationText notif={notif} />
        <p className="text-[10px] text-ink/60 mt-1 uppercase tracking-widest">
          {formatDate(notif.created_at)}
        </p>
      </div>
      {unread && (
        <span
          aria-label="Não lida"
          title="Não lida"
          className="w-2 h-2 bg-arcane border border-ink mt-1 flex-shrink-0"
        />
      )}
    </li>
  )
}

// NotificationText: texto adaptado por type. Cada tipo conhece os
// campos que precisa e gera frase + links. Tipos futuros entram
// como case no switch.
function NotificationText({ notif }: { notif: Notification }) {
  const actor = notif.actor_username ? (
    <Link
      to={`/u/${notif.actor_username}`}
      className="font-bold hover:text-arcane hover:underline underline-offset-4 decoration-2"
    >
      {notif.actor_display_name ?? notif.actor_username}
    </Link>
  ) : (
    <span className="font-bold italic">[usuário removido]</span>
  )
  const asset = notif.asset_id && notif.asset_title ? (
    <Link
      to={`/asset/${notif.asset_id}`}
      className="font-bold hover:text-arcane hover:underline underline-offset-4 decoration-2"
    >
      {notif.asset_title}
    </Link>
  ) : (
    <span className="font-bold italic">[asset removido]</span>
  )

  switch (notif.type) {
    case 'asset_sold':
      return (
        <p>
          {actor} comprou {asset}.
        </p>
      )
    case 'asset_reviewed':
      return (
        <p>
          {actor} avaliou {asset}.
        </p>
      )
    case 'purchase_confirmation':
      // Você comprou {asset} de {actor}. Aqui o actor é o VENDEDOR
      // (dono do asset), não quem fez a ação — frase reflete isso.
      return (
        <p>
          Você comprou {asset} de {actor}.
        </p>
      )
    default:
      return <p>Notificação desconhecida.</p>
  }
}
