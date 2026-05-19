import { memo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fileUrl, type Asset } from '../api/client'
import Avatar from './Avatar'

// Card de asset na vitrine. Agora é INTERATIVO: clicar leva pra
// /asset/:id (página de detalhe com o viewer 3D). Por isso ganhou
// o efeito de "press" no hover — mesmo padrão dos botões.
//
// Trocou de <article> para <Link>: HTML5 permite <article> dentro
// de <a>, mas como o card inteiro vira um único hit-target, agrupar
// a semântica num só elemento é mais simples. Para ferramentas de
// acessibilidade, o Link descrito pelo title do asset é suficiente.

type Props = {
  asset: Asset
  // priority: thumbnail above-the-fold. Renderiza com fetchpriority=high
  // + loading=eager para melhorar o LCP da galeria.
  priority?: boolean
}

function AssetCardImpl({ asset, priority = false }: Props) {
  // imgFailed cobre o caso do .png ter sumido (DB inconsistente,
  // upload incompleto). Sem isso aparece o ícone quebrado do browser.
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <Link
      to={`/asset/${asset.id}`}
      className="
        block bg-parchment border-4 border-ink shadow-pixel
        transition-all duration-75 ease-out
        hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
      "
    >
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
        {/* No card mostramos só a primeira tag + um "+N" se houver mais —
            evita ocupar espaço demais em modelos muito tageados. A lista
            completa fica no /asset/:id. */}
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <span className="inline-block bg-arcane text-parchment text-[10px] px-2 py-0.5 uppercase tracking-widest font-bold">
              {asset.tags[0]}
            </span>
            {asset.tags.length > 1 && (
              <span className="inline-block bg-ink text-parchment text-[10px] px-2 py-0.5 uppercase tracking-widest font-bold">
                +{asset.tags.length - 1}
              </span>
            )}
          </div>
        )}
        <h2
          className="font-bold text-sm uppercase tracking-wider truncate"
          title={asset.title}
        >
          {asset.title}
        </h2>
        {/* Avatar + nome do autor. Link explícito para /u/:username
            seria HTML inválido aqui (anchor aninhada no Link do card),
            então mantemos só o display — a navegação pro perfil é
            feita pelo AssetDetail. */}
        <div className="flex items-center gap-2">
          <Avatar
            avatarPath={asset.author_avatar_path}
            name={asset.author_name ?? '?'}
            size="xs"
          />
          <p className="text-xs truncate">
            por{' '}
            <span className="font-bold">
              {asset.author_name ?? 'anônimo'}
            </span>
          </p>
        </div>
        <p className="text-sm font-bold pt-1">
          ✦ {formatPrice(asset.price_cents)}
        </p>
      </div>
    </Link>
  )
}

const AssetCard = memo(AssetCardImpl)
export default AssetCard

// formatPrice em escopo de módulo — construtor caro relativo ao
// .format(). Duplicado em AssetDetail.tsx; quando aparecer um 3º
// consumer, extrair pra src/lib/format.ts.
const priceFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function formatPrice(cents: number): string {
  return priceFormatter.format(cents / 100)
}
