import { Link, useLocation } from 'react-router-dom'

// /404 (catch-all): renderizada quando nenhuma rota casa.
//
// Antes essa rota redirecionava silenciosamente pra /. Isso escondia
// erros (typo numa URL compartilhada) e era confuso pro usuário —
// ele clicava num link que não tinha mais e voltava pra galeria sem
// explicação.
//
// Mostra a URL tentada pra ajudar debug e oferece dois caminhos:
// galeria (entrada principal) e voltar (browser history).
export default function NotFound() {
  const location = useLocation()

  return (
    <div className="max-w-md mx-auto mt-16 p-6">
      <div className="bg-parchment border-4 border-ink shadow-pixel p-8 text-center">
        <p className="font-pixel text-3xl mb-4 text-arcane" aria-hidden="true">
          404
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Caminho não encontrado
        </p>
        <p className="text-xs text-ink/70 tracking-wider mb-6 break-all">
          <span className="font-mono bg-ink/10 px-2 py-0.5">
            {location.pathname}
          </span>
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            to="/"
            className="
              inline-block bg-arcane text-parchment border-4 border-ink shadow-pixel
              px-4 py-2 text-xs font-bold uppercase tracking-widest
              transition-all duration-75 ease-out
              hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
            "
          >
            ▶ Galeria
          </Link>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="
              inline-block bg-parchment text-ink border-4 border-ink shadow-pixel
              px-4 py-2 text-xs font-bold uppercase tracking-widest
              transition-all duration-75 ease-out
              hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
            "
          >
            ◀ Voltar
          </button>
        </div>
      </div>
    </div>
  )
}
