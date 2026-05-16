import { useCallback, useEffect, useState } from 'react'
import { api, type Asset } from '../api/client'
import AssetCard from '../components/AssetCard'
import AssetCardSkeleton from '../components/AssetCardSkeleton'

// Galeria pública. Estados modelados como discriminação implícita
// (assets null vs []) em vez de três booleans — só um caso pode ser
// verdade por vez:
//
//   assets === null + error === null  → loading (skeletons)
//   assets === null + error           → erro
//   assets === []   + error === null  → vazio
//   assets:Asset[]  + error === null  → grid de cards

const SKELETON_COUNT = 8
const GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 p-6'
// Primeiros 4 cards assumimos acima da dobra no maior breakpoint
// (4 colunas). Ganham fetchpriority=high para acelerar o LCP.
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

  if (error) {
    return (
      <div className="max-w-md mx-auto mt-16 p-6">
        <div className="bg-ink text-parchment border-4 border-ink shadow-pixel p-8 text-center">
          <p className="text-4xl mb-4" aria-hidden="true">
            ✗
          </p>
          <p className="text-sm font-bold uppercase tracking-widest mb-6">
            {error}
          </p>
          <button
            onClick={() => load()}
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
      <div className="max-w-md mx-auto mt-16 p-6">
        <div className="bg-parchment border-4 border-ink shadow-pixel p-8 text-center">
          <p className="text-4xl mb-4" aria-hidden="true">
            ✦
          </p>
          <p className="text-sm font-bold uppercase tracking-widest mb-2">
            Inventário vazio
          </p>
          <p className="text-xs text-ink/70 tracking-wider">
            Nenhum asset publicado ainda
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={GRID_CLASSES}>
      {assets.map((asset, i) => (
        <AssetCard key={asset.id} asset={asset} priority={i < PRIORITY_COUNT} />
      ))}
    </div>
  )
}
