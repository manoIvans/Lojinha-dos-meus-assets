import { memo } from 'react'

// StarRating: 5 estrelas pixel-art renderizadas como caracteres ★/☆.
//
// Dois modos:
//   - readonly (default): só exibe value (pode ser float — usado no
//     summary "média 4.3"). Estrela meio-preenchida não é suportada
//     no pixel-art simples; arredondamos via floor pra evitar UI
//     prometendo precisão que não temos.
//   - interactive (onChange definido): renderiza buttons clicáveis,
//     hover muda o estado visual via state local (sem rebote do
//     value externo até o click).
//
// Tamanhos: 'sm' (12px) pra cards, 'md' (16px) padrão, 'lg' (24px)
// pro form de criar review.

type Size = 'sm' | 'md' | 'lg'

type Props = {
  value: number // 0..5 (pode ser float em readonly)
  onChange?: (v: number) => void // se definido, vira interativo
  size?: Size
  // label opcional pra acessibilidade (ex: "4.3 de 5 estrelas").
  ariaLabel?: string
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'text-xs',
  md: 'text-base',
  lg: 'text-2xl',
}

function StarRatingImpl({ value, onChange, size = 'md', ariaLabel }: Props) {
  const sizeClass = SIZE_CLASSES[size]
  const interactive = !!onChange
  // Floor pra readonly: 4.7 mostra 4 estrelas cheias. Aceitável pra
  // simplicidade visual; quando precisar de meia estrela, trocar
  // pra SVG path com clipPath.
  const filled = Math.floor(value)

  if (!interactive) {
    return (
      <span
        role="img"
        aria-label={ariaLabel ?? `${value.toFixed(1)} de 5 estrelas`}
        className={`${sizeClass} text-arcane tracking-wider`}
      >
        {Array.from({ length: 5 }).map((_, i) =>
          i < filled ? '★' : '☆',
        ).join('')}
      </span>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? 'Avaliação em estrelas'}
      className={`inline-flex gap-1 ${sizeClass}`}
    >
      {Array.from({ length: 5 }).map((_, i) => {
        const star = i + 1
        const isFilled = star <= value
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} estrela${star > 1 ? 's' : ''}`}
            onClick={() => onChange!(star)}
            className={`
              ${isFilled ? 'text-arcane' : 'text-ink/30'}
              hover:text-arcane transition-colors duration-75
              focus:outline-none focus-visible:ring-2 focus-visible:ring-arcane
            `}
          >
            {isFilled ? '★' : '☆'}
          </button>
        )
      })}
    </div>
  )
}

const StarRating = memo(StarRatingImpl)
export default StarRating
