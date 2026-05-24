import type { Asset } from '../api/client'

// Sort do catálogo da galeria. Lógica de sort + label das opções +
// parser do search param fica aqui (não na Gallery) pra que (a) seja
// testável sem montar React e (b) outras telas eventualmente reusem
// as mesmas opções (ex: MyStore, UserProfile).
//
// SORT_OPTIONS é a única source-of-truth: parseSort valida URL, o
// dropdown renderiza via map, e sortAssets opera nos mesmos keys.

export type SortKey =
  | 'recent'
  | 'oldest'
  | 'price_asc'
  | 'price_desc'
  | 'title_asc'
  | 'title_desc'
  | 'rating_desc'

export const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'recent', label: 'Mais recentes' },
  { key: 'oldest', label: 'Mais antigos' },
  { key: 'rating_desc', label: 'Melhor avaliados' },
  { key: 'price_asc', label: 'Preço ↑' },
  { key: 'price_desc', label: 'Preço ↓' },
  { key: 'title_asc', label: 'Título A-Z' },
  { key: 'title_desc', label: 'Título Z-A' },
]

// parseSort: aceita o que vem da URL ou null. Qualquer valor fora
// das chaves conhecidas vira o default ('recent') — protege contra
// usuário digitando ?sort=garbage e crashing.
export function parseSort(raw: string | null): SortKey {
  if (!raw) return 'recent'
  return SORT_OPTIONS.some((o) => o.key === raw) ? (raw as SortKey) : 'recent'
}

// sortAssets é PURA: não muta `list`. Cria uma cópia com spread antes
// de sort() porque Array.prototype.sort in-place. Comparadores
// retornam negativo/positivo/zero — padrão JS.
//
// Tiebreaker: quando dois assets têm o mesmo valor da chave primária
// (ex: preço igual), caímos pra created_at desc (mais novo primeiro).
// Sem tiebreaker, sort do JS não é estável em todos os engines antigos.
export function sortAssets(list: Asset[], key: SortKey): Asset[] {
  const copy = [...list]
  const byCreatedDesc = (a: Asset, b: Asset) =>
    b.created_at.localeCompare(a.created_at)

  switch (key) {
    case 'recent':
      return copy.sort(byCreatedDesc)
    case 'oldest':
      return copy.sort((a, b) => a.created_at.localeCompare(b.created_at))
    case 'price_asc':
      return copy.sort((a, b) => a.price_cents - b.price_cents || byCreatedDesc(a, b))
    case 'price_desc':
      return copy.sort((a, b) => b.price_cents - a.price_cents || byCreatedDesc(a, b))
    case 'title_asc':
      return copy.sort(
        (a, b) => a.title.localeCompare(b.title, 'pt-BR') || byCreatedDesc(a, b),
      )
    case 'title_desc':
      return copy.sort(
        (a, b) => b.title.localeCompare(a.title, 'pt-BR') || byCreatedDesc(a, b),
      )
    case 'rating_desc':
      // Assets sem reviews (average_rating null OU review_count 0)
      // são empurrados pro FIM via fallback -1 — não devem vir na
      // frente de assets com nota baixa real.
      return copy.sort((a, b) => {
        const ra = a.average_rating ?? -1
        const rb = b.average_rating ?? -1
        if (ra !== rb) return rb - ra
        // Tiebreaker 1: count maior (mais reviews) → mais confiável.
        const ca = a.review_count ?? 0
        const cb = b.review_count ?? 0
        if (ca !== cb) return cb - ca
        // Tiebreaker 2: created_at desc.
        return byCreatedDesc(a, b)
      })
  }
}
