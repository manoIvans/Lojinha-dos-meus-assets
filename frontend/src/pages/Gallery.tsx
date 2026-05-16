import { useCallback, useEffect, useState } from 'react'
import { api, type Asset } from '../api/client'
import AssetCard from '../components/AssetCard'
import AssetCardSkeleton from '../components/AssetCardSkeleton'

// Gallery é a vitrine pública. Fluxo:
//   1. Loading (assets === null)  → renderiza grid de skeletons.
//   2. Erro                       → mensagem + botão "tentar de novo".
//   3. Lista vazia                → estado neutro.
//   4. Sucesso                    → grid de AssetCard.
//
// Estado modelado como discriminação implícita (assets null vs []) em
// vez de uma máquina de estados formal — três variáveis (loading/
// error/data) escondiam o fato de que só um deles é verdade por vez.
const SKELETON_COUNT = 8
const GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-6'

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

    // Função de cancelamento devolvida pra quem chamar (o useEffect
    // abaixo). Evita setState após unmount em StrictMode, que dispara
    // o effect duas vezes em dev.
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
      <div className="max-w-md mx-auto mt-12 p-6 text-center">
        <p className="text-red-600 mb-3">{error}</p>
        <button
          onClick={() => load()}
          className="text-sm underline hover:text-black"
        >
          Tentar novamente
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
      <p className="p-6 text-gray-500">Nenhum asset publicado ainda.</p>
    )
  }

  return (
    <div className={GRID_CLASSES}>
      {assets.map((asset) => (
        <AssetCard key={asset.id} asset={asset} />
      ))}
    </div>
  )
}
