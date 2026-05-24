import { describe, it, expect } from 'vitest'
import { formatPrice, formatDate } from './format'

// Formatters dependem de Intl com locale pt-BR. Os asserts usam
// .toContain ou normalização via replace(/ /g, ' ') porque o
// Intl injeta NBSP (non-breaking space) entre "R$" e o número. Sem
// isso, o teste passa local mas quebra em CI com versão de ICU
// ligeiramente diferente.

describe('formatPrice', () => {
  it('formata centavos como BRL', () => {
    // 2990 cents = R$ 29,90
    const got = formatPrice(2990).replace(/ /g, ' ')
    expect(got).toBe('R$ 29,90')
  })

  it('lida com zero', () => {
    expect(formatPrice(0).replace(/ /g, ' ')).toBe('R$ 0,00')
  })

  it('arredonda corretamente em divisão por 100', () => {
    // 1 cent = R$ 0,01 (não R$ 0,00 por erro de float)
    expect(formatPrice(1).replace(/ /g, ' ')).toBe('R$ 0,01')
    expect(formatPrice(99).replace(/ /g, ' ')).toBe('R$ 0,99')
    expect(formatPrice(100).replace(/ /g, ' ')).toBe('R$ 1,00')
  })

  it('lida com valores grandes', () => {
    // Verifica separador de milhar pt-BR (ponto).
    const got = formatPrice(1234567).replace(/ /g, ' ')
    expect(got).toContain('12.345')
  })
})

describe('formatDate', () => {
  it('converte ISO em DD/MM/YYYY', () => {
    expect(formatDate('2025-03-15T10:30:00Z')).toBe('15/03/2025')
  })

  it('preserva ano completo', () => {
    expect(formatDate('1999-12-31T23:59:59Z')).toBe('31/12/1999')
  })
})
