// Esqueleto com a MESMA silhueta do AssetCard real:
//   - imagem quadrada (aspect-square) ocupa o mesmo espaço,
//   - três linhas de texto com larguras parecidas com título/autor/preço.
//
// Manter as dimensões iguais evita que o layout "salte" quando o
// fetch termina — a galeria fica mais agradável de olhar enquanto
// carrega.
//
// animate-pulse vem do Tailwind: um keyframe de opacidade que dá
// o efeito de "respirando" sem precisar de CSS custom.
export default function AssetCardSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse"
    >
      <div className="aspect-square bg-gray-200" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-gray-200 rounded w-3/4" />
        <div className="h-3 bg-gray-200 rounded w-1/2" />
        <div className="h-4 bg-gray-200 rounded w-1/3 mt-2" />
      </div>
    </article>
  )
}
