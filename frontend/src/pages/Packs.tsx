import { memo, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fileUrl, type Pack } from '../api/client'
import { formatPrice } from '../lib/format'
import Avatar from '../components/Avatar'

// /packs: catálogo público de packs. Paginado server-side (envelope
// {items, page_size, total}). Layout em grid igual aos asset cards.
//
// Cada PackCard mostra: thumb (própria ou do 1º item via fallback),
// título, autor, contagem de items, preço. Click leva pra /pack/:id.

const PAGE_SIZE = 24
const GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'

type PacksPage = {
  items: Pack[]
  page: number
  page_size: number
  total: number
}

export default function Packs() {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PacksPage | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((p: number) => {
    setError(null)
    setData(null)
    let cancelled = false
    api
      .get<PacksPage>(`/api/v1/packs?page=${p}&page_size=${PAGE_SIZE}`)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch(() => {
        if (!cancelled) setError('Falha ao carregar packs.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = load(page)
    return cancel
  }, [load, page])

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.page_size))
    : 1

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
        ▶ Packs
      </p>
      <div className="px-6 py-5">
        <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
          Bundles de assets
        </h1>
        <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
          ▸ {subtitle(total, loading)}
        </p>
      </div>
    </header>
  )
}

function subtitle(total: number | null, loading: boolean): string {
  if (loading) return 'Carregando packs...'
  if (total === null) return 'Falha ao carregar'
  if (total === 0) return 'Nenhum pack ainda'
  if (total === 1) return '1 pack'
  return `${total} packs`
}

function Content({
  items,
  error,
  onRetry,
}: {
  items: Pack[] | null
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
        {Array.from({ length: 8 }).map((_, i) => (
          <PackCardSkeleton key={i} />
        ))}
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center">
        <p className="text-5xl mb-4" aria-hidden="true">
          ◆
        </p>
        <p className="text-sm font-bold uppercase tracking-widest">
          Nenhum pack ainda
        </p>
      </div>
    )
  }
  return (
    <div className={GRID_CLASSES}>
      {items.map((p) => (
        <PackCard key={p.id} pack={p} />
      ))}
    </div>
  )
}

const PackCard = memo(function PackCard({ pack }: { pack: Pack }) {
  const thumb = pack.thumbnail_path ?? null
  const count = pack.items_count ?? 0
  return (
    <Link
      to={`/pack/${pack.id}`}
      className="
        block bg-parchment border-4 border-arcane shadow-pixel
        transition-all duration-75 ease-out
        hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
        overflow-hidden
      "
    >
      {thumb ? (
        <img
          src={fileUrl(thumb)}
          alt={pack.title}
          className="w-full aspect-square object-cover border-b-4 border-ink"
          loading="lazy"
        />
      ) : (
        <div className="w-full aspect-square bg-arcane/20 border-b-4 border-ink flex items-center justify-center font-bold uppercase tracking-widest">
          Pack
        </div>
      )}
      <div className="p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-arcane font-bold">
          ◆ Pack · {count} {count === 1 ? 'asset' : 'assets'}
        </p>
        <h3 className="font-bold text-sm uppercase tracking-wider truncate">
          {pack.title}
        </h3>
        <div className="flex items-center gap-2">
          <Avatar
            avatarPath={pack.author_avatar_path}
            name={pack.author_name ?? '?'}
            size="xs"
          />
          <p className="text-[10px] uppercase tracking-widest text-ink/60 truncate">
            {pack.author_name ?? 'anônimo'}
          </p>
        </div>
        <p className="text-sm font-bold">✦ {formatPrice(pack.price_cents)}</p>
      </div>
    </Link>
  )
})

function PackCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="bg-parchment border-4 border-ink shadow-pixel animate-pulse"
    >
      <div className="w-full aspect-square bg-ink/20 border-b-4 border-ink" />
      <div className="p-3 space-y-2">
        <div className="h-2 bg-ink/20 w-1/3" />
        <div className="h-3 bg-ink/20 w-2/3" />
        <div className="h-2 bg-ink/20 w-1/2" />
      </div>
    </div>
  )
}

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
      aria-label="Paginação dos packs"
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
