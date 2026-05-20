// Formatadores de DISPLAY (preço e data). Antes estavam duplicados
// em ~4 arquivos com a mesma config (pt-BR/BRL/DD-MM-YYYY); aqui
// ficam centralizados pra que mudar a localização (ex: en-US, EUR)
// seja edição em UM lugar.
//
// Os formatters do Intl são CAROS de construir relativo ao .format(),
// daí instanciá-los em escopo de módulo: uma vez por carga do bundle,
// não a cada render.

const priceFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

// formatPrice: cents (int) → "R$ 29,90". Não validamos input — o
// backend já garante price_cents >= 0 via CHECK constraint.
export function formatPrice(cents: number): string {
  return priceFormatter.format(cents / 100)
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

// formatDate: ISO string do backend → "DD/MM/YYYY". new Date(iso)
// aceita ISO 8601 nativamente. Em locale errado o navegador degrada
// pra MM/DD/YYYY — pra evitar isso forçamos pt-BR no formatter.
export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso))
}
