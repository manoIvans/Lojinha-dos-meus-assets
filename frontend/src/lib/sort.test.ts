import { describe, it, expect } from 'vitest'
import type { Asset } from '../api/client'
import { parseSort, sortAssets, SORT_OPTIONS } from './sort'

// Helper pra criar Asset minimal pros testes — só os campos que
// importam pro sort. Os demais ficam com defaults sensatos.
function makeAsset(overrides: Partial<Asset>): Asset {
  return {
    id: 1,
    owner_id: 1,
    title: 'X',
    description: '',
    tags: [],
    price_cents: 0,
    thumbnail_path: '',
    model_path: '',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('parseSort', () => {
  it('null/empty → recent (default)', () => {
    expect(parseSort(null)).toBe('recent')
    expect(parseSort('')).toBe('recent')
  })

  it('aceita todas as chaves de SORT_OPTIONS', () => {
    for (const opt of SORT_OPTIONS) {
      expect(parseSort(opt.key)).toBe(opt.key)
    }
  })

  it('valor desconhecido → recent (graceful fallback)', () => {
    expect(parseSort('garbage')).toBe('recent')
    expect(parseSort('hot')).toBe('recent')
  })
})

describe('sortAssets', () => {
  // Setup: 3 assets com datas/preços/ratings distintos
  // pra exercitar todos os comparadores.
  const a = makeAsset({
    id: 1, title: 'Alpha', price_cents: 1000, created_at: '2024-03-01T00:00:00Z',
    average_rating: 4.5, review_count: 10,
  })
  const b = makeAsset({
    id: 2, title: 'Bravo', price_cents: 500, created_at: '2024-02-01T00:00:00Z',
    average_rating: 5.0, review_count: 2,
  })
  const c = makeAsset({
    id: 3, title: 'Charlie', price_cents: 2000, created_at: '2024-01-01T00:00:00Z',
    average_rating: null, review_count: 0,
  })
  const list = [a, b, c]

  it('não muta o array original', () => {
    const copy = [...list]
    sortAssets(list, 'price_asc')
    expect(list).toEqual(copy)
  })

  it('recent: created_at DESC (a → b → c)', () => {
    expect(sortAssets(list, 'recent').map((x) => x.id)).toEqual([1, 2, 3])
  })

  it('oldest: created_at ASC (c → b → a)', () => {
    expect(sortAssets(list, 'oldest').map((x) => x.id)).toEqual([3, 2, 1])
  })

  it('price_asc: barato → caro (b 500 → a 1000 → c 2000)', () => {
    expect(sortAssets(list, 'price_asc').map((x) => x.id)).toEqual([2, 1, 3])
  })

  it('price_desc: caro → barato (c 2000 → a 1000 → b 500)', () => {
    expect(sortAssets(list, 'price_desc').map((x) => x.id)).toEqual([3, 1, 2])
  })

  it('title_asc: ordem alfabética (Alpha → Bravo → Charlie)', () => {
    expect(sortAssets(list, 'title_asc').map((x) => x.id)).toEqual([1, 2, 3])
  })

  it('title_desc: ordem alfabética inversa', () => {
    expect(sortAssets(list, 'title_desc').map((x) => x.id)).toEqual([3, 2, 1])
  })

  it('rating_desc: melhor primeiro, sem-rating no fim', () => {
    // b (5.0) → a (4.5) → c (null, vai pro fim).
    expect(sortAssets(list, 'rating_desc').map((x) => x.id)).toEqual([2, 1, 3])
  })

  it('rating_desc: empate em rating → maior review_count primeiro', () => {
    const x = makeAsset({ id: 10, average_rating: 4.5, review_count: 3, created_at: '2024-01-01T00:00:00Z' })
    const y = makeAsset({ id: 20, average_rating: 4.5, review_count: 10, created_at: '2024-01-01T00:00:00Z' })
    // y tem mais reviews — vem primeiro.
    expect(sortAssets([x, y], 'rating_desc').map((v) => v.id)).toEqual([20, 10])
  })

  it('price_asc com empate cai pra created_at DESC', () => {
    const older = makeAsset({ id: 100, price_cents: 100, created_at: '2024-01-01T00:00:00Z' })
    const newer = makeAsset({ id: 200, price_cents: 100, created_at: '2024-06-01T00:00:00Z' })
    // Mesmo preço — mais novo (200) vem primeiro.
    expect(sortAssets([older, newer], 'price_asc').map((v) => v.id)).toEqual([200, 100])
  })

  it('title_asc com pt-BR: respeita acentos', () => {
    // 'á' deveria ordenar junto/depois de 'a' em pt-BR — não no fim
    // do array como em ordenação ASCII pura.
    const items = [
      makeAsset({ id: 1, title: 'Banana' }),
      makeAsset({ id: 2, title: 'Água' }),
      makeAsset({ id: 3, title: 'Abacate' }),
    ]
    const result = sortAssets(items, 'title_asc').map((x) => x.title)
    // Abacate < Água < Banana em pt-BR.
    expect(result).toEqual(['Abacate', 'Água', 'Banana'])
  })

  it('lista vazia retorna lista vazia', () => {
    expect(sortAssets([], 'recent')).toEqual([])
  })
})
