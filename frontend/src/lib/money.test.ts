import { describe, it, expect } from 'vitest'
import { toCents, fromCents } from './money'

describe('toCents', () => {
  it('inteiro: "12" → 1200', () => {
    expect(toCents('12')).toBe(1200)
  })

  it('decimal com ponto: "12.90" → 1290', () => {
    expect(toCents('12.90')).toBe(1290)
  })

  it('decimal com vírgula (BR): "12,90" → 1290', () => {
    expect(toCents('12,90')).toBe(1290)
  })

  it('zero é válido', () => {
    expect(toCents('0')).toBe(0)
  })

  it('trim de espaços', () => {
    expect(toCents('  29,90  ')).toBe(2990)
  })

  it('arredonda decimal exato', () => {
    // 0.1 + 0.2 dá 0.30000000000000004 em float — Math.round
    // protege a saída.
    expect(toCents('0.30')).toBe(30)
  })

  it('retorna null pra string vazia', () => {
    expect(toCents('')).toBeNull()
    expect(toCents('   ')).toBeNull()
  })

  it('retorna null pra não-número', () => {
    expect(toCents('abc')).toBeNull()
    expect(toCents('12abc')).toBeNull()
  })

  it('retorna null pra negativo', () => {
    expect(toCents('-5')).toBeNull()
    expect(toCents('-0.01')).toBeNull()
  })

  it('retorna null pra NaN/Infinity', () => {
    expect(toCents('Infinity')).toBeNull()
  })
})

describe('fromCents', () => {
  it('inteiro: 1200 → "12,00" (separador vírgula BR)', () => {
    expect(fromCents(1200)).toBe('12,00')
  })

  it('com decimais: 2990 → "29,90"', () => {
    expect(fromCents(2990)).toBe('29,90')
  })

  it('zero → "0,00"', () => {
    expect(fromCents(0)).toBe('0,00')
  })

  it('é o inverso de toCents (roundtrip)', () => {
    // Roundtrip preserva valor.
    const cents = toCents('99,99')
    expect(cents).toBe(9999)
    expect(fromCents(cents!)).toBe('99,99')
  })
})
