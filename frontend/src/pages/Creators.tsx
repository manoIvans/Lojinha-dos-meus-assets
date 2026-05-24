import { memo, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type PublicUser } from '../api/client'
import Avatar from '../components/Avatar'

// /criadores: diretório paginado dos usuários. Cards clicáveis levam
// pra /u/:username (a "loja" individual).
//
// Paginação opt-in do backend: passamos ?page=N&page_size=24 pra
// receber o envelope {items, page, page_size, total}. Cliente controla
// a página atual em state local — sem refletir na URL por enquanto
// (compromisso entre simplicidade e link compartilhável).

const PAGE_SIZE = 24
const SKELETON_COUNT = 8
const GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'

type CreatorsPage = {
  items: PublicUser[]
  page: number
  page_size: number
  total: number
}

export default function Creators() {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<CreatorsPage | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((p: number) => {
    setError(null)
    setData(null)
    let cancelled = false

    api
      .get<CreatorsPage>(`/api/v1/users?page=${p}&page_size=${PAGE_SIZE}`)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch(() => {
        if (!cancelled) setError('Falha ao carregar criadores.')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = load(page)
    return cancel
  }, [load, page])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <Hero
        total={error ? null : data?.total ?? null}
        loading={!error && data === null}
      />
      <Content
        items={data?.items ?? null}
        error={error}
        onRetry={() => load(page)}
      />
      {data && data.total > 0 && (
        <Pager
          page={page}
          totalPages={totalPages}
          onChange={setPage}
        />
      )}
    </div>
  )
}

function Hero({
  total,
  loading,
}: {
  total: number | null
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
          ▸ {subtitle(total, loading)}
        </p>
      </div>
    </header>
  )
}

function subtitle(total: number | null, loading: boolean): string {
  if (loading) return 'Carregando criadores...'
  if (total === null) return 'Falha ao carregar'
  if (total === 0) return 'Nenhum criador ainda'
  if (total === 1) return '1 criador'
  return `${total} criadores`
}

function Content({
  items,
  error,
  onRetry,
}: {
  items: PublicUser[] | null
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

  if (items === null) {
    return (
      <div className={GRID_CLASSES} aria-busy="true" aria-live="polite">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <CreatorCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
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
      {items.map((u) => (
        <CreatorCard key={u.id} user={u} />
      ))}
    </div>
  )
}

// Pager: navegação prev/next com indicador "Página X de Y". Setas
// ficam desabilitadas nos extremos. Cliquezinho no botão move o
// state, useEffect re-fetch automático.
function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number
  totalPages: number
  onChange: (p: number) => void
}) {
  const canPrev = page > 1
  const canNext = page < totalPages
  return (
    <nav
      aria-label="Paginação dos criadores"
      className="bg-parchment border-4 border-ink shadow-pixel px-4 py-3 flex items-center justify-between gap-3"
    >
      <button
        type="button"
        onClick={() => canPrev && onChange(page - 1)}
        disabled={!canPrev}
        className="
          bg-ink text-parchment border-4 border-ink shadow-pixel
          px-3 py-2 text-xs font-bold uppercase tracking-widest
          transition-all duration-75 ease-out
          hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          disabled:opacity-40 disabled:cursor-not-allowed
          disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-pixel
        "
      >
        ◀ Anterior
      </button>
      <p className="text-xs uppercase tracking-widest text-ink/70 font-bold">
        Página {page} de {totalPages}
      </p>
      <button
        type="button"
        onClick={() => canNext && onChange(page + 1)}
        disabled={!canNext}
        className="
          bg-ink text-parchment border-4 border-ink shadow-pixel
          px-3 py-2 text-xs font-bold uppercase tracking-widest
          transition-all duration-75 ease-out
          hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          disabled:opacity-40 disabled:cursor-not-allowed
          disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-pixel
        "
      >
        Próxima ▶
      </button>
    </nav>
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
