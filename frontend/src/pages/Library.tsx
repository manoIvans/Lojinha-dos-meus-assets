import { Link } from 'react-router-dom'

// Biblioteca: lista os assets que o usuário COMPROU. Como o sistema
// de compras ainda não existe (não há tabela purchases, endpoint, nem
// fluxo de pagamento), por ora a rota só renderiza um empty state
// honesto. Quando o pipeline de checkout entrar, basta trocar o
// conteúdo desta página por um <Grid /> consumindo /api/v1/my/library.
//
// Decisão: manter a rota viva mesmo sem dados evita re-arquitetar
// navegação depois e dá ao usuário um lugar consistente para olhar.
export default function Library() {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <header className="bg-parchment border-4 border-ink shadow-pixel">
        <p className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
          ▶ Biblioteca
        </p>
        <div className="px-6 py-5">
          <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
            Baú do Aventureiro
          </h1>
          <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
            ▸ Seus assets adquiridos
          </p>
        </div>
      </header>

      <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center">
        <p className="text-5xl mb-4" aria-hidden="true">
          ⚿
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Em breve
        </p>
        <p className="text-xs text-ink/70 tracking-wider mb-6 max-w-md mx-auto">
          O sistema de compras está sendo forjado. Quando estiver pronto,
          seus assets adquiridos aparecerão aqui.
        </p>
        <Link
          to="/"
          className="
            inline-block bg-arcane text-parchment border-4 border-ink shadow-pixel
            px-4 py-2 text-xs font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ▶ Explorar o catálogo
        </Link>
      </div>
    </div>
  )
}
