import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

// Shell de todas as páginas. A combinação bg-parchment + text-ink +
// font-mono é aplicada no root para que TODA descendência herde a
// estética RPG sem precisar repetir as classes em cada página.
//
// Header é uma "title bar" de jogo:
//   - Linha principal roxo arcano com a marca + nav links
//   - Faixa de madeira embaixo dando um efeito de "moldura"
//   - Item de rota ATIVA recebe cores invertidas (parchment + ink),
//     replicando o feel de "menu item selecionado" em RPGs antigos.

// Função de classes para NavLink. NavLink chama isso a cada render
// passando isActive — TS infere o tipo do argumento, mas ser explícito
// melhora a legibilidade.
function navLinkClasses({ isActive }: { isActive: boolean }) {
  // Borda 2px sempre presente (transparent quando inativo) para que o
  // layout NÃO mude de tamanho quando o estado ativo entra/sai. Sem
  // isso, os links pulam de posição na navegação.
  const base =
    'inline-block px-3 py-1 text-xs uppercase tracking-widest font-bold border-2 transition-colors duration-75'
  return isActive
    ? `${base} bg-parchment text-ink border-ink`
    : `${base} border-transparent text-parchment hover:bg-ink/30`
}

export default function Layout() {
  const { isAuthenticated, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col bg-twilight-scan text-ink font-mono">
      <header>
        <nav className="bg-arcane text-parchment px-6 py-4 border-b-4 border-ink flex items-center gap-4">
          {/* Marca em duas linhas: nome principal com star decorativa +
              tagline minúscula abaixo, no esquema "logo de jogo retrô". */}
          <Link
            to="/"
            className="flex items-center gap-3 mr-2 group leading-none"
            aria-label="Página inicial"
          >
            <span className="text-xl text-parchment group-hover:text-parchment/80">
              ★
            </span>
            <span className="flex flex-col gap-1.5">
              {/* font-pixel = Press Start 2P. Removidos font-bold (a fonte
                  bitmap não tem variações de peso) e tracking custom (já
                  vem espaçada). Mantive uppercase como segurança caso o
                  texto futuro tenha minúsculas — a fonte só tem caixa alta. */}
              <span className="font-pixel text-sm uppercase">Lojinha</span>
              <span className="text-[9px] uppercase tracking-[0.4em] text-parchment/60">
                Assets Raros
              </span>
            </span>
          </Link>

          {/* Separador vertical com baixa opacidade — divide marca do menu */}
          <span aria-hidden="true" className="text-parchment/30 select-none">
            │
          </span>

          {/* NavLink (vs Link) habilita o estado isActive para mostrar
              a rota atual. `end` no link "/" evita que ele fique ativo
              em todas as rotas (já que "/" é prefixo de tudo). */}
          <NavLink to="/" end className={navLinkClasses}>
            Galeria
          </NavLink>
          {isAuthenticated && (
            <NavLink to="/dashboard" className={navLinkClasses}>
              Dashboard
            </NavLink>
          )}

          {/* Ação de auth alinhada à direita. Ícone ▶ só aqui, para
              destacar como ação principal (não navegação interna). */}
          <div className="ml-auto">
            {isAuthenticated ? (
              <button
                onClick={handleLogout}
                className="px-3 py-1 text-xs uppercase tracking-widest font-bold border-2 border-transparent text-parchment transition-colors duration-75 hover:bg-ink/30"
              >
                ▶ Sair
              </button>
            ) : (
              <NavLink
                to="/login"
                className={({ isActive }) =>
                  `inline-block px-3 py-1 text-xs uppercase tracking-widest font-bold border-2 transition-colors duration-75 ${
                    isActive
                      ? 'bg-parchment text-ink border-ink'
                      : 'border-transparent text-parchment hover:bg-ink/30'
                  }`
                }
              >
                ▶ Entrar
              </NavLink>
            )}
          </div>
        </nav>

      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
