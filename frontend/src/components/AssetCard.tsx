import { memo, useState } from 'react'
import { fileUrl, type Asset } from '../api/client'

// Card de asset estilizado como ficha de item de RPG:
//   ┌────────────────────────────┐
//   │       [ thumbnail ]        │
//   ├────────────────────────────┤  <- separador pixel
//   │ [CATEGORIA]                │  <- tag verde musgo
//   │ TÍTULO DO ITEM             │
//   │ por autor                  │
//   │ ✦ R$ 29,90                 │
//   └────────────────────────────┘
//
// Bordas grossas em ink + shadow-pixel dão o efeito 3D pixelado. Não
// aplicamos hover-press aqui porque o card ainda não navega — quando
// virar link para detalhe, adiciona-se a translate+shadow-none.

type Props = {
  asset: Asset
  // priority: indica thumbnail above-the-fold. Renderiza com
  // fetchpriority=high + loading=eager para melhorar o LCP.
  priority?: boolean
}

function AssetCardImpl({ asset, priority = false }: Props) {
  // imgFailed cobre thumbnail apontando pra arquivo que sumiu
  // (DB corrompido, upload incompleto). Sem isso aparece o ícone
  // quebrado do navegador.
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <article className="bg-parchment border-4 border-ink shadow-pixel">
      <div className="aspect-square bg-parchment overflow-hidden">
        {imgFailed ? (
          <div className="w-full h-full flex items-center justify-center text-ink/50 text-xs uppercase tracking-widest">
            sem imagem
          </div>
        ) : (
          <img
            src={fileUrl(asset.thumbnail_path)}
            alt={asset.title}
            loading={priority ? 'eager' : 'lazy'}
            // fetchPriority é case-sensitive em React (camelCase). HTML
            // final fica `fetchpriority`. Navegadores antigos ignoram.
            fetchPriority={priority ? 'high' : 'low'}
            decoding="async"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        )}
      </div>

      <div className="border-t-4 border-ink p-3 space-y-1.5">
        <span className="inline-block bg-arcane text-parchment text-[10px] px-2 py-0.5 uppercase tracking-widest font-bold">
          {asset.category}
        </span>
        <h2
          className="font-bold text-sm uppercase tracking-wider truncate"
          title={asset.title}
        >
          {asset.title}
        </h2>
        <p className="text-xs">
          por <span className="font-bold">{asset.author_name ?? 'anônimo'}</span>
        </p>
        <p className="text-sm font-bold pt-1">
          ✦ {formatPrice(asset.price_cents)}
        </p>
      </div>
    </article>
  )
}

const AssetCard = memo(AssetCardImpl)
export default AssetCard

// formatPrice em escopo de módulo: o construtor de Intl.NumberFormat
// é caro relativo ao .format(). Sem isso, instância nova a cada render
// de cada card.
const priceFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function formatPrice(cents: number): string {
  return priceFormatter.format(cents / 100)
}
