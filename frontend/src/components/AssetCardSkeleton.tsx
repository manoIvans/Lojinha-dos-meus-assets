// Esqueleto com a mesma silhueta do AssetCard real: bordas grossas,
// sombra pixel, separador entre imagem e info. Mantem dimensões iguais
// para que o layout não dance quando os dados reais chegam.
//
// O efeito de "respirando" vem de bg-ink/20 + animate-pulse. Não usei
// gradiente shimmer porque destoa do visual flat pixel.
export default function AssetCardSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="bg-parchment border-4 border-ink shadow-pixel animate-pulse"
    >
      <div className="aspect-square bg-ink/20" />
      <div className="border-t-4 border-ink p-3 space-y-2">
        <div className="h-3 bg-ink/20 w-1/3" />
        <div className="h-4 bg-ink/20 w-3/4" />
        <div className="h-3 bg-ink/20 w-1/2" />
        <div className="h-4 bg-ink/20 w-1/4 mt-1" />
      </div>
    </article>
  )
}
