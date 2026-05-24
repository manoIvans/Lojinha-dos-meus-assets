import { describe, it, expect } from 'vitest'
import { parseTags } from './tags'

describe('parseTags', () => {
  it('split por vírgula', () => {
    expect(parseTags('rpg, fantasia, lowpoly')).toEqual([
      'rpg',
      'fantasia',
      'lowpoly',
    ])
  })

  it('split por newline (cole multi-linha)', () => {
    expect(parseTags('rpg\nfantasia\nlowpoly')).toEqual([
      'rpg',
      'fantasia',
      'lowpoly',
    ])
  })

  it('mistura vírgula + newline', () => {
    expect(parseTags('rpg, fantasia\nlowpoly,3d')).toEqual([
      'rpg',
      'fantasia',
      'lowpoly',
      '3d',
    ])
  })

  it('trim de cada tag', () => {
    expect(parseTags('  rpg  ,  fantasia  ')).toEqual(['rpg', 'fantasia'])
  })

  it('descarta tags vazias', () => {
    // 3 vírgulas consecutivas → 4 splits, 3 vazias.
    expect(parseTags('rpg,,,,fantasia')).toEqual(['rpg', 'fantasia'])
  })

  it('dedup case-sensitive', () => {
    // "3D" e "3d" coexistem por design (matching com backend
    // normalizeTags em asset_handler.go).
    expect(parseTags('3D, 3d, 3D, lowpoly')).toEqual(['3D', '3d', 'lowpoly'])
  })

  it('preserva ordem de inserção', () => {
    expect(parseTags('z, a, m')).toEqual(['z', 'a', 'm'])
  })

  it('string vazia retorna []', () => {
    expect(parseTags('')).toEqual([])
    expect(parseTags('   ')).toEqual([])
    expect(parseTags(',,,')).toEqual([])
  })
})
