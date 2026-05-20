// Classes Tailwind compartilhadas do tema pixel-art.
//
// Antes ficavam duplicadas em 4-5 arquivos cada — mudar o efeito
// hover ou a borda exigia varrer cada cópia. Aqui ficam centralizadas.
//
// Convenção: o caller adiciona TAMANHO (text-xs/text-sm) e CORES
// (bg-arcane text-parchment ou bg-parchment text-ink). Mantemos só
// a "estrutura" pixel-art (borda, sombra, transição, hover-press).
// Isso evita ter 4 variantes de PIXEL_BTN com pequenas variações.

export const PIXEL_BTN =
  'border-4 border-ink shadow-pixel px-4 py-2 font-bold uppercase tracking-widest ' +
  'transition-all duration-75 ease-out ' +
  'hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none ' +
  'disabled:opacity-50 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-pixel'

export const PIXEL_INPUT =
  'mt-1 block w-full bg-white text-ink border-4 border-ink px-3 py-2 ' +
  'font-mono focus:outline-none focus:shadow-pixel-sm'

// ASSET_GRID_CLASSES: responsive grid pros AssetCard. 1 col em
// mobile, escala até 4 colunas em desktop. gap-6 dá respiro
// suficiente sem desperdiçar espaço. Usado por Gallery, MyStore,
// Favorites, UserProfile.
//
// Creators tem grid próprio (gap-4) porque os cards são menores e
// horizontais — não compartilha esta config.
export const ASSET_GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6'
