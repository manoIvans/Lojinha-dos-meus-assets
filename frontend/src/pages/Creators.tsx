import { memo, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type PublicUser } from '../api/client'
import Avatar from '../components/Avatar'

// /criadores: diretório de todos os usuários. Cards clicáveis levam
// pra /u/:username (a "loja" individual).
//
// Mesma estrutura mental da Gallery — Hero + Grid + estados.
// Como esperamos relativamente poucos usuários (muito menos que
// assets), sem paginação por ora.

const SKELETON_COUNT = 8
const GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'

export default function Creators() {
  const [users, setUsers] = useState<PublicUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    setUsers(null)
    let cancelled = false

    api
      .get<PublicUser[]>('/api/v1/users')
      .then((data) => {
        if (!cancelled) setUsers(data)
      })
      .catch(() => {
        if (!cancelled) setError('Falha ao carregar criadores.')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = load()
    return cancel
  }, [load])

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <Hero
        count={error ? null : users?.length ?? null}
        loading={!error && users === null}
      />
      <Content users={users} error={error} onRetry={load} />
    </div>
  )
}

function Hero({
  count,
  loading,
}: {
  count: number | null
  loading: boolean
}) {
  return (
    <header className="bg-parchment border-4 border-ink shadow-pixel">
      <p className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
        ▶ Criadores
      </p>
      <div className="px-6 py-5">
        <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
          Aventureiros da ManoMesh
        </h1>
        <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
          ▸ {subtitle(count, loading)}
        </p>
      </div>
    </header>
  )
}

function subtitle(count: number | null, loading: boolean): string {
  if (loading) return 'Carregando criadores...'
  if (count === null) return 'Falha ao carregar'
  if (count === 0) return 'Nenhum criador ainda'
  if (count === 1) return '1 criador'
  return `${count} criadores`
}

function Content({
  users,
  error,
  onRetry,
}: {
  users: PublicUser[] | null
  error: string | null
  onRetry: () => void
}) {
  if (error) {
    return (
      <div className="bg-ink text-parchment border-4 border-ink shadow-pixel p-8 text-center">
        <p className="text-4xl mb-4" aria-hidden="true">
          ✗
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-6">
          {error}
        </p>
        <button
          onClick={onRetry}
          className="
            bg-parchment text-ink border-4 border-ink shadow-pixel
            px-4 py-2 text-xs font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ▶ Tentar novamente
        </button>
      </div>
    )
  }

  if (users === null) {
    return (
      <div className={GRID_CLASSES} aria-busy="true" aria-live="polite">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <CreatorCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center">
        <p className="text-5xl mb-4" aria-hidden="true">
          ✦
        </p>
        <p className="text-sm font-bold uppercase tracking-widest">
          Nenhum criador cadastrado
        </p>
      </div>
    )
  }

  return (
    <div className={GRID_CLASSES}>
      {users.map((u) => (
        <CreatorCard key={u.id} user={u} />
      ))}
    </div>
  )
}

// CreatorCard: bloco clicável com avatar, display_name, @username e
// contagem de assets. Link inteiro pra /u/:username — diferente do
// AssetCard, aqui não há sub-actions, então um Link único é suficiente.
//
// memo: `user` é estável por linha; retry do pai não cascateia.
const CreatorCard = memo(function CreatorCard({ user }: { user: PublicUser }) {
  const count = user.asset_count ?? 0
  return (
    <Link
      to={`/u/${user.username}`}
      className="
        block bg-parchment border-4 border-ink shadow-pixel
        transition-all duration-75 ease-out
        hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
        p-4 flex items-center gap-3
      "
    >
      <Avatar
        avatarPath={user.avatar_path}
        name={user.display_name}
        size="md"
      />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm uppercase tracking-wider truncate">
          {user.display_name}
        </p>
        <p className="text-[10px] uppercase tracking-widest text-ink/60 mt-0.5">
          @{user.username}
        </p>
        <p className="text-[10px] uppercase tracking-widest text-ink/70 mt-1">
          {count === 0
            ? 'nenhum asset'
            : count === 1
              ? '1 asset'
              : `${count} assets`}
        </p>
      </div>
    </Link>
  )
})

// CreatorCardSkeleton: silhueta com avatar + linhas — mantém layout
// estável enquanto a lista carrega.
function CreatorCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="bg-parchment border-4 border-ink shadow-pixel p-4 flex items-center gap-3 animate-pulse"
    >
      <div className="w-12 h-12 bg-ink/20 border-2 border-ink shadow-pixel-sm flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-ink/20 w-2/3" />
        <div className="h-2 bg-ink/20 w-1/2" />
        <div className="h-2 bg-ink/20 w-1/3" />
      </div>
    </div>
  )
}
