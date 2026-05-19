import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Asset } from '../api/client'
import AssetCard from '../components/AssetCard'
import AssetCardSkeleton from '../components/AssetCardSkeleton'

// Minha Loja: lista APENAS os assets cujo owner_id é o do usuário
// logado. Backend já faz o filtro (GET /api/v1/my/assets) — o front
// só renderiza. Mesmo card da Galeria é reutilizado: clicar leva pra
// /asset/:id onde o OwnerPanel já oferece Editar/Deletar.
//
// Estados (mesma discriminação implícita usada em Gallery):
//   assets === null + error === null  → loading (skeletons)
//   assets === null + error           → erro com retry
//   assets === []   + error === null  → loja vazia (CTA pro Dashboard)
//   assets:Asset[]  + error === null  → grid de cards

const SKELETON_COUNT = 4
const GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6'

export default function MyStore() {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    setAssets(null)
    let cancelled = false

    api
      .get<Asset[]>('/api/v1/my/assets')
      .then((data) => {
        if (!cancelled) setAssets(data)
      })
      .catch(() => {
        if (!cancelled) setError('Falha ao carregar sua loja.')
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
      <Hero count={error ? null : assets?.length ?? null} loading={!error && assets === null} />
      <Content assets={assets} error={error} onRetry={load} />
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
        ▶ Minha Loja
      </p>
      <div className="px-6 py-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
            Forja do Aventureiro
          </h1>
          <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
            ▸ {subtitle(count, loading)}
          </p>
        </div>
        {/* CTA pro Dashboard pra publicar novo asset. Estilo "botão
            pixel completo" pra destacar a ação principal da página. */}
        <Link
          to="/dashboard"
          className="
            inline-block bg-arcane text-parchment border-4 border-ink shadow-pixel
            px-4 py-2 text-xs font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ▶ Publicar novo
        </Link>
      </div>
    </header>
  )
}

function subtitle(count: number | null, loading: boolean): string {
  if (loading) return 'Carregando sua loja...'
  if (count === null) return 'Falha ao carregar'
  if (count === 0) return 'Nenhum asset publicado ainda'
  if (count === 1) return '1 asset na sua loja'
  return `${count} assets na sua loja`
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
          ⚒
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Sua loja está vazia
        </p>
        <p className="text-xs text-ink/70 tracking-wider mb-6">
          Publique seu primeiro asset e comece a aventurar-se!
        </p>
        <Link
          to="/dashboard"
          className="
            inline-block bg-arcane text-parchment border-4 border-ink shadow-pixel
            px-4 py-2 text-xs font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ▶ Publicar agora
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
