import { type MouseEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useFavorites } from '../favorites/FavoritesContext'
import { useToast } from './Toast'

// FavoriteButton: alterna favorito de um asset. Dois variantes
// visuais via prop `variant`:
//
//   - "overlay": pixel-art compacto, usado em cima da thumbnail do
//     AssetCard. Posição absoluta no card via wrapper externo.
//   - "inline":  botão maior com label "Favoritar"/"Salvo", usado
//     no AssetDetail.
//
// Quando o usuário não está autenticado, ainda renderizamos o botão
// mas clicar mostra um toast pedindo login (em vez de esconder o
// botão — descobrimento da feature).

type Variant = 'overlay' | 'inline'

type Props = {
  assetID: number
  variant?: Variant
  // stopPropagation: usado no AssetCard pra que o click no coração
  // NÃO ative o Link do card inteiro (que levaria pro /asset/:id).
  // Default true porque é o caso mais comum (cards clicáveis).
  stopPropagation?: boolean
}

export default function FavoriteButton({
  assetID,
  variant = 'inline',
  stopPropagation = true,
}: Props) {
  const { isAuthenticated } = useAuth()
  const { isFavorite, toggle } = useFavorites()
  const toast = useToast()

  const favorited = isFavorite(assetID)

  async function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (stopPropagation) {
      e.stopPropagation()
      e.preventDefault()
    }
    if (!isAuthenticated) {
      toast.info('Entre pra favoritar assets')
      return
    }
    try {
      await toggle(assetID)
    } catch {
      toast.error(favorited ? 'Falha ao desfavoritar' : 'Falha ao favoritar')
    }
  }

  const label = favorited ? 'Salvo' : 'Favoritar'
  const icon = favorited ? '♥' : '♡'

  if (variant === 'overlay') {
    // Quadrado pequeno, position-absoluto colocado pelo wrapper.
    // bg-parchment quando inativo, bg-arcane quando ativo —
    // cor amplifica o estado pra leitura rápida no card.
    const bg = favorited ? 'bg-arcane text-parchment' : 'bg-parchment text-ink'
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={favorited}
        aria-label={favorited ? 'Desfavoritar' : 'Favoritar'}
        title={label}
        className={`
          ${bg} border-2 border-ink shadow-pixel-sm
          w-8 h-8 flex items-center justify-center text-base font-bold
          transition-all duration-75 ease-out
          hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
        `}
      >
        {icon}
      </button>
    )
  }

  // inline: full button com label.
  const bg = favorited ? 'bg-arcane text-parchment' : 'bg-parchment text-ink'
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={favorited}
      className={`
        ${bg} border-4 border-ink shadow-pixel
        px-4 py-2 text-xs font-bold uppercase tracking-widest
        transition-all duration-75 ease-out
        hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
        flex items-center gap-2
      `}
    >
      <span aria-hidden="true">{icon}</span> {label}
    </button>
  )
}
