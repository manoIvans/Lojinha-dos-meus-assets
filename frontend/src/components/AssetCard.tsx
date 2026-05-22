import { memo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fileUrl, type Asset } from '../api/client'
import { formatPrice } from '../lib/format'
import Avatar from './Avatar'
import CartButton from './CartButton'
import FavoriteButton from './FavoriteButton'
import StarRating from './StarRating'

// Card de asset na vitrine. Estrutura com DOIS Links:
//
//   <article>
//     <Link to="/asset/:id">  ← imagem + tags + título + preço
//     <Link to="/u/:username"> ← rodapé com avatar + nome do autor
//
// Anchors aninhadas são HTML inválido, então a área principal e a
// do autor são irmãs dentro de <article>. Cada uma tem seu próprio
// efeito hover. Mantém a borda/sombra do card como envelope visual
// (no <article>) e o "press" só na zona principal — feedback
// distinto entre "ir pro asset" e "ir pro criador".
//
// O FavoriteButton e o CartButton ficam fora de ambos os Links,
// posicionados absolutamente em cima da thumbnail. Cada um já tem
// stopPropagation porque herdam do flow antigo (não dentro de Link
// agora, mas mantido pra robustez).

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
  // imgLoaded controla o fade-in da thumbnail. Default false → mostra
  // shimmer placeholder; vira true quando onLoad dispara (inclusive
  // pra imagens em cache, que ainda assim disparam onLoad).
  const [imgLoaded, setImgLoaded] = useState(false)

  return (
    <article
      className="
        relative bg-parchment border-4 border-ink shadow-pixel
        transition-all duration-75 ease-out
        hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
      "
    >
      {/* Link principal — área grande que leva pro detalhe do asset.
          Sem press próprio: o efeito está no <article> pai pra que
          borda + sombra + conteúdo afundem juntos (sem desalinho).
          focus-visible: ring arcane só com keyboard (não no click do
          mouse) — pixel-art outline sem cor de plataforma. */}
      <Link
        to={`/asset/${asset.id}`}
        className="block focus:outline-none focus-visible:ring-4 focus-visible:ring-arcane focus-visible:ring-inset"
      >
        <div className="relative aspect-square bg-parchment overflow-hidden">
          {imgFailed ? (
            <div className="w-full h-full flex items-center justify-center text-ink/50 text-xs uppercase tracking-widest">
              sem imagem
            </div>
          ) : (
            <>
              {/* Shimmer placeholder: aparece enquanto img.src carrega.
                  bg-ink/10 + animate-pulse mantém estética sem precisar
                  de SVG ou gradient extra. Some quando imgLoaded vira
                  true OU quando onError dispara (imgFailed esconde
                  o branch inteiro). */}
              {!imgLoaded && (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-ink/10 animate-pulse"
                />
              )}
              <img
                src={fileUrl(asset.thumbnail_path)}
                alt={asset.title}
                loading={priority ? 'eager' : 'lazy'}
                // fetchPriority é case-sensitive em React (camelCase). HTML
                // final fica `fetchpriority`. Navegadores antigos ignoram.
                fetchPriority={priority ? 'high' : 'low'}
                decoding="async"
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgFailed(true)}
                className={`
                  w-full h-full object-cover
                  transition-opacity duration-200
                  ${imgLoaded ? 'opacity-100' : 'opacity-0'}
                `}
              />
            </>
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
          {/* Rating compacto: estrelas + count. Aparece quando ALGUM
              review existe (count > 0). Sem reviews → linha some,
              não ocupa espaço vazio. */}
          {(asset.review_count ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-ink/70">
              <StarRating
                value={asset.average_rating ?? 0}
                size="sm"
                ariaLabel={`${(asset.average_rating ?? 0).toFixed(1)} estrelas (${asset.review_count})`}
              />
              <span>({asset.review_count})</span>
            </div>
          )}
          <p className="text-sm font-bold pt-1">
            ✦ {formatPrice(asset.price_cents)}
          </p>
        </div>
      </Link>

      {/* Faixa do autor: Link separado pra /u/:username. O press do
          card já acontece no hover via <article>; aqui adicionamos
          hover EXTRA (bg-ink/10 + nome em arcane) pra deixar claro
          que essa zona leva pra outro destino. */}
      {asset.author_username ? (
        <Link
          to={`/u/${asset.author_username}`}
          className="
            block border-t-2 border-ink/20 px-3 py-2
            transition-colors duration-75 ease-out
            hover:bg-ink/10 group
            focus:outline-none focus-visible:ring-4 focus-visible:ring-arcane focus-visible:ring-inset
          "
        >
          <div className="flex items-center gap-2">
            <Avatar
              avatarPath={asset.author_avatar_path}
              name={asset.author_name ?? '?'}
              size="xs"
            />
            <p className="text-xs truncate">
              por{' '}
              <span className="font-bold group-hover:text-arcane group-hover:underline underline-offset-4 decoration-2">
                {asset.author_name ?? 'anônimo'}
              </span>
            </p>
          </div>
        </Link>
      ) : (
        // Fallback caso o asset não tenha author_username (resposta
        // antiga ou JOIN faltando) — sem Link, só texto.
        <div className="border-t-2 border-ink/20 px-3 py-2 flex items-center gap-2">
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
      )}

      {/* Overlay vertical no canto superior direito: favorito em cima,
          carrinho embaixo. Posicionado absoluto no <article> pra
          ficar acima dos dois Links irmãos. Cada botão já tem
          stopPropagation+preventDefault internamente. */}
      <div className="absolute top-2 right-2 flex flex-col gap-2">
        <FavoriteButton assetID={asset.id} variant="overlay" />
        <CartButton assetID={asset.id} variant="overlay" />
      </div>
    </article>
  )
}

const AssetCard = memo(AssetCardImpl)
export default AssetCard
