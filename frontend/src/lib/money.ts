// Parser de input monetário do form. Distinto do formatter (display)
// porque o usuário digita formatos variados ("12", "12.90", "12,90")
// e queremos aceitar todos sem forçar uma máscara.
//
// Backend sempre persiste em centavos (int), nunca em float — então
// a conversão precisa ser explícita aqui.

// toCents: string do input → int (cents) ou null se inválido.
// Aceita vírgula como separador decimal (convenção BR) convertendo
// pra ponto antes do Number(). Trim primeiro pra ignorar espaços
// acidentais.
//
// null = ANY input não convertível: vazio, "abc", negativo, NaN.
// Caller decide se mostra erro ou aceita.
export function toCents(raw: string): number | null {
  const normalized = raw.replace(',', '.').trim()
  if (!normalized) return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

// fromCents: int (cents) → string com vírgula decimal, pra colocar
// em input controlado de form. Usado só na inicialização (carrega
// price_cents do asset e mostra "29,90" no input).
//
// Não usar pra DISPLAY — pra UI consumidora prefira formatPrice
// (em src/lib/format.ts) que devolve "R$ 29,90" com locale.
export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}
