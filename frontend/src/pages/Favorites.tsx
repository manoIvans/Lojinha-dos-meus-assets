import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Asset } from '../api/client'
import AssetCard from '../components/AssetCard'
import AssetCardSkeleton from '../components/AssetCardSkeleton'
import { useFavorites } from '../favorites/FavoritesContext'

// /favoritos: assets que o usuário salvou via FavoriteButton.
// Mesmo shape de MyStore — grid simples sem filtros (poucos itens
// esperados). Ordenação vem do backend: created_at do favorito
// (mais recente em cima).

const SKELETON_COUNT = 4
const GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6'

export default function Favorites() {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { ids } = useFavorites()

  const load = useCallback(() => {
    setError(null)
    setAssets(null)
    let cancelled = false

    api
      .get<Asset[]>('/api/v1/my/favorites')
      .then((data) => {
        if (!cancelled) setAssets(data)
      })
      .catch(() => {
        if (!cancelled) setError('Falha ao carregar seus favoritos.')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = load()
    return cancel
  }, [load])

  // Filtra o Asset[] pelo Set atual de IDs favoritados. Mantém a
  // página em sincronia quando o usuário desfavorita um card AQUI
  // mesmo (otimistic update no FavoritesContext remove o ID; este
  // useMemo recalcula e a card some). Quando `ids` ainda está
  // carregando (undefined), mostra a lista bruta.
  const visible = useMemo<Asset[] | null>(() => {
    if (!assets) return null
    if (!ids) return assets
    return assets.filter((a) => ids.has(a.id))
  }, [assets, ids])

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <Hero count={error ? null : visible?.length ?? null} loading={!error && visible === null} />
      <Content assets={visible} error={error} onRetry={load} />
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
        ▶ Favoritos
      </p>
      <div className="px-6 py-5">
        <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
          ♥ Salvos pra depois
        </h1>
        <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
          ▸ {subtitle(count, loading)}
        </p>
      </div>
    </header>
  )
}

function subtitle(count: number | null, loading: boolean): string {
  if (loading) return 'Carregando seus favoritos...'
  if (count === null) return 'Falha ao carregar'
  if (count === 0) return 'Nenhum favorito ainda'
  if (count === 1) return '1 asset favoritado'
  return `${count} assets favoritados`
}

function Content({
  assets,
  error,
  onRetry,
}: {
  assets: Asset[] | null
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

  if (assets === null) {
    return (
      <div className={GRID_CLASSES} aria-busy="true" aria-live="polite">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <AssetCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (assets.length === 0) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center">
        <p className="text-5xl mb-4" aria-hidden="true">
          ♡
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Você ainda não favoritou nada
        </p>
        <p className="text-xs text-ink/70 tracking-wider mb-6">
          Explore a galeria e clique no coração dos assets que curtir.
        </p>
        <Link
          to="/"
          className="
            inline-block bg-arcane text-parchment border-4 border-ink shadow-pixel
            px-4 py-2 text-xs font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ▶ Explorar o catálogo
        </Link>
      </div>
    )
  }

  return (
    <div className={GRID_CLASSES}>
      {assets.map((asset, i) => (
        <AssetCard key={asset.id} asset={asset} priority={i < 4} />
      ))}
    </div>
  )
}
