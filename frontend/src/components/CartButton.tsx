import { type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useCart } from '../cart/CartContext'
import { useToast } from './Toast'

// CartButton: gêmeo do FavoriteButton, mas pro carrinho. Mesmas
// variantes (overlay/inline) e mesma lógica de stopPropagation.
//
// Diferente do FavoriteButton: este componente tem 3 estados visuais:
//   - Já comprado → renderiza link "Na biblioteca" (não é botão)
//   - No carrinho → botão "Remover do carrinho"
//   - Não está   → botão "Adicionar ao carrinho"
//
// Quando o asset é do próprio usuário, o caller (AssetDetail) deve
// esconder o botão — backend rejeita 409 de qualquer jeito, mas
// mostrar e bloquear UI é pior UX.

type Variant = 'overlay' | 'inline'

type Props = {
  assetID: number
  variant?: Variant
  stopPropagation?: boolean
}

export default function CartButton({
  assetID,
  variant = 'inline',
  stopPropagation = true,
}: Props) {
  const { isAuthenticated } = useAuth()
  const { isInCart, isPurchased, toggle } = useCart()
  const toast = useToast()

  const purchased = isPurchased(assetID)
  const inCart = isInCart(assetID)

  async function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (stopPropagation) {
      e.stopPropagation()
      e.preventDefault()
    }
    if (!isAuthenticated) {
      toast.info('Entre pra adicionar ao carrinho')
      return
    }
    try {
      await toggle(assetID)
    } catch {
      toast.error(inCart ? 'Falha ao remover do carrinho' : 'Falha ao adicionar ao carrinho')
    }
  }

  // Já comprado: vira link pro /library em vez de botão. O usuário
  // não pode comprar de novo (backend bloqueia). Diferente visualmente
  // pra deixar claro que é "ação concluída".
  if (purchased) {
    if (variant === 'overlay') {
      // Sem stopPropagation aqui porque é Link, e queremos que o
      // click no overlay leve direto pra /library em vez de pro
      // /asset/:id. Mas Links nested em Links são inválidos —
      // então usamos onClick + preventDefault no card wrapper.
      // Simplificação: renderiza apenas um badge sem nav. UX:
      // o usuário pode clicar no card e ir pro detalhe, que tem
      // o botão "Na biblioteca" cheio.
      return (
        <div
          aria-label="Já comprado"
          title="Na biblioteca"
          className="
            bg-twilight text-parchment border-2 border-ink shadow-pixel-sm
            w-8 h-8 flex items-center justify-center text-base font-bold
          "
        >
          ✓
        </div>
      )
    }
    return (
      <Link
        to="/library"
        className="
          bg-twilight text-parchment border-4 border-ink shadow-pixel
          px-4 py-2 text-xs font-bold uppercase tracking-widest
          transition-all duration-75 ease-out
          hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          flex items-center gap-2
        "
      >
        <span aria-hidden="true">✓</span> Na biblioteca
      </Link>
    )
  }

  const label = inCart ? 'No carrinho' : 'Adicionar ao carrinho'
  const shortLabel = inCart ? 'No carrinho' : 'Comprar'
  const icon = inCart ? '✓' : '⌬'

  if (variant === 'overlay') {
    const bg = inCart ? 'bg-arcane text-parchment' : 'bg-parchment text-ink'
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={inCart}
        aria-label={inCart ? 'Remover do carrinho' : 'Adicionar ao carrinho'}
        title={label}
        className={`
          ${bg} border-2 border-ink shadow-pixel-sm
          w-8 h-8 flex items-center justify-center text-sm font-bold
          transition-all duration-75 ease-out
          hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
        `}
      >
        {icon}
      </button>
    )
  }

  const bg = inCart ? 'bg-arcane text-parchment' : 'bg-parchment text-ink'
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={inCart}
      className={`
        ${bg} border-4 border-ink shadow-pixel
        px-4 py-2 text-xs font-bold uppercase tracking-widest
        transition-all duration-75 ease-out
        hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
        flex items-center gap-2
      `}
    >
      <span aria-hidden="true">{icon}</span> {shortLabel}
    </button>
  )
}
