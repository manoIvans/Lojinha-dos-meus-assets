import { useCallback, useEffect, useState } from 'react'
import { api, type Asset } from '../api/client'
import AssetCard from '../components/AssetCard'
import AssetCardSkeleton from '../components/AssetCardSkeleton'

// Galeria pública.
//
// Layout reestruturado para que o HERO esteja SEMPRE presente — antes
// cada estado (loading/erro/vazio) retornava sua própria árvore, o
// que fazia o header sumir e a página "saltar" visualmente quando os
// dados chegavam. Agora a estrutura é:
//
//   <div>
//     <Hero count={...} />        ← sempre renderizado
//     <Content ... />              ← skeletons / erro / vazio / grid
//   </div>
//
// Estado modelado como discriminação implícita (assets null vs []):
//
//   assets === null + error === null  → loading (skeletons)
//   assets === null + error           → erro com retry
//   assets === []   + error === null  → vazio
//   assets:Asset[]  + error === null  → grid de cards

const SKELETON_COUNT = 8
const GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6'
// Primeiros 4 cards assumimos acima da dobra (4 colunas). Recebem
// fetchpriority=high para acelerar o LCP.
const PRIORITY_COUNT = 4

export default function Gallery() {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    setAssets(null)
    let cancelled = false

    api
      .get<Asset[]>('/api/v1/assets')
      .then((data) => {
        if (!cancelled) setAssets(data)
      })
      .catch(() => {
        if (!cancelled) setError('Falha ao carregar a galeria.')
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
        count={error ? null : assets?.length ?? null}
        loading={!error && assets === null}
      />
      <Content assets={assets} error={error} onRetry={load} />
    </div>
  )
}

// Hero: identidade da página + contador dinâmico. Permanece em todos
// os estados (loading/error/empty/success) — só o subtítulo muda
// para refletir o status. Sem isso o header sumiria durante o fetch
// e voltaria depois, criando um "salto" visual.
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
        ▶ Catálogo
      </p>
      <div className="px-6 py-5">
        <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
          Mercado dos Aventureiros
        </h1>
        <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
          ▸ {subtitle(count, loading)}
        </p>
      </div>
    </header>
  )
}

function subtitle(count: number | null, loading: boolean): string {
  if (loading) return 'Carregando catálogo...'
  if (count === null) return 'Falha ao carregar'
  if (count === 0) return 'Inventário vazio'
  if (count === 1) return '1 asset publicado'
  return `${count} assets publicados`
}

// Content: renderiza o conteúdo específico para cada estado. Separado
// do componente principal para deixar o JSX top-level legível.
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
          ✦
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Inventário vazio
        </p>
        <p className="text-xs text-ink/70 tracking-wider">
          Nenhum asset publicado ainda — seja o primeiro!
        </p>
      </div>
    )
  }

  return (
    <div className={GRID_CLASSES}>
      {assets.map((asset, i) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          priority={i < PRIORITY_COUNT}
        />
      ))}
    </div>
  )
}
