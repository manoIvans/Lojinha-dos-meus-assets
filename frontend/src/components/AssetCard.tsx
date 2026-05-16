import { useState } from 'react'
import { fileUrl, type Asset } from '../api/client'

// Card de um asset na vitrine. Recebe o asset já carregado — fetching
// fica no componente-pai (Gallery). Mantém o card 100% apresentacional
// e fácil de reaproveitar (ex: "outros assets do mesmo autor" amanhã).
type Props = {
  asset: Asset
}

export default function AssetCard({ asset }: Props) {
  // imgFailed cobre o caso comum de thumbnail apontando pra um arquivo
  // que sumiu (DB corrompido, upload incompleto). Sem isso o navegador
  // renderiza o alt + ícone quebrado, que parece bug em vez de
  // "imagem indisponível".
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <article className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="aspect-square bg-gray-100">
        {imgFailed ? (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
            sem imagem
          </div>
        ) : (
          <img
            src={fileUrl(asset.thumbnail_path)}
            alt={asset.title}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        )}
      </div>
      <div className="p-3">
        <h2 className="font-medium truncate" title={asset.title}>
          {asset.title}
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          por {asset.author_name ?? 'anônimo'}
        </p>
        <p className="text-sm mt-2 font-semibold">
          {formatPrice(asset.price_cents)}
        </p>
      </div>
    </article>
  )
}

// formatPrice usa Intl.NumberFormat para dar uma string localizada
// ("R$ 29,90"). Mais robusto do que concatenar manualmente, e cobre
// edge cases como milhar (R$ 1.299,90).
function formatPrice(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}
