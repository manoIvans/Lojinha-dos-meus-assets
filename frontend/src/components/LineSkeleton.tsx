// Esqueleto horizontal pra páginas que listam items em LINHAS (Cart,
// Library). Mantém a mesma altura/silhueta do item real pra evitar
// layout shift quando os dados chegam.
//
// Pixel-art: borda 4px ink + shadow-pixel + animate-pulse. Espelha
// o AssetCardSkeleton mas no formato horizontal.
export default function LineSkeleton() {
  return (
    <li
      aria-hidden="true"
      className="bg-parchment border-4 border-ink shadow-pixel p-3 flex items-center gap-3 animate-pulse"
    >
      {/* Thumbnail placeholder — mesmo 16x16 do item real (Cart/Library) */}
      <div className="w-16 h-16 bg-ink/20 border-2 border-ink shadow-pixel-sm flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-ink/20 w-3/4" />
        <div className="h-3 bg-ink/20 w-1/2" />
        <div className="h-3 bg-ink/20 w-1/3" />
      </div>
      <div className="space-y-2 flex-shrink-0 text-right">
        <div className="h-4 bg-ink/20 w-16 ml-auto" />
        <div className="h-3 bg-ink/20 w-12 ml-auto" />
      </div>
    </li>
  )
}
