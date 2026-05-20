import { memo, useState } from 'react'
import { fileUrl } from '../api/client'

// Avatar: thumbnail circular do usuário, com fallback de inicial.
//
// Quatro tamanhos pra cobrir todos os usos:
//   xs = 20px (chip, card de asset)
//   sm = 32px (lista, AssetDetail)
//   md = 48px (header)
//   lg = 96px (página de perfil)
//
// Quando não há avatar_path (usuário sem foto OU asset cujo author não
// foi populado via JOIN), renderiza um quadrado pixel-art com a inicial
// do display_name em destaque. Mantém o "feel" da app sem precisar de
// CDN de gravatar ou serviço externo.
//
// Pixel-art: borda 2px ink + shadow-pixel-sm; SEM border-radius (RPG
// não tem círculo). Quadrado fica coerente com cards/chips.

type Size = 'xs' | 'sm' | 'md' | 'lg'

type Props = {
  // Caminho relativo retornado pelo backend (ex: "avatars/abc.png").
  // null/undefined → fallback. Vazio também conta como fallback.
  avatarPath?: string | null
  // Nome usado pra inicial no fallback. Pega o primeiro char não-espaço,
  // upper case. Se vazio, fica "?".
  name: string
  size?: Size
  // Quando true, fica em escala maior no hover — usado em cards
  // clicáveis. Default false porque na maioria dos lugares é estático.
  interactive?: boolean
}

const SIZES: Record<Size, { box: string; text: string }> = {
  xs: { box: 'w-5 h-5', text: 'text-[10px]' },
  sm: { box: 'w-8 h-8', text: 'text-sm' },
  md: { box: 'w-12 h-12', text: 'text-lg' },
  lg: { box: 'w-24 h-24', text: 'text-4xl' },
}

// memo: Avatar aparece em listas (Gallery, Creators, /carrinho,
// /library, etc) — N por página. Props são primitivas estáveis por
// item (avatarPath, name, size, interactive); re-render do pai não
// precisa cascatear aqui.
function AvatarImpl({
  avatarPath,
  name,
  size = 'sm',
  interactive = false,
}: Props) {
  // Falha de carregamento (path no DB aponta pra arquivo inexistente)
  // cai no fallback — mesmo trat. que o AssetCard faz com thumbnails.
  const [imgFailed, setImgFailed] = useState(false)
  const hasImage = avatarPath && !imgFailed
  const sz = SIZES[size]

  // Inicial: primeiro caractere não-espaço, upper. Se a string for
  // vazia ou só espaços (defensivo), cai pra "?".
  const initial = (name.trim()[0] ?? '?').toUpperCase()

  const base = `${sz.box} border-2 border-ink shadow-pixel-sm overflow-hidden flex-shrink-0`
  const hoverScale = interactive
    ? 'transition-transform duration-75 ease-out group-hover:translate-x-[2px] group-hover:translate-y-[2px]'
    : ''

  if (hasImage) {
    return (
      <img
        src={fileUrl(avatarPath!)}
        alt={`Avatar de ${name}`}
        loading="lazy"
        decoding="async"
        onError={() => setImgFailed(true)}
        className={`${base} ${hoverScale} object-cover`}
      />
    )
  }

  return (
    <div
      aria-label={`Avatar de ${name} (sem foto)`}
      className={`${base} ${hoverScale} bg-arcane text-parchment flex items-center justify-center font-pixel ${sz.text}`}
    >
      {initial}
    </div>
  )
}

const Avatar = memo(AvatarImpl)
export default Avatar
