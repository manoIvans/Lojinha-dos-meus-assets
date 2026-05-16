import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

// Layout é o shell de todas as páginas: navbar fixa + <Outlet/> para
// o conteúdo da rota atual. Mantemos só a navegação aqui — qualquer
// chrome adicional (footer, banner, breadcrumb) entra no mesmo lugar.
export default function Layout() {
  const { isAuthenticated, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900">
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
        <Link to="/" className="font-semibold text-lg">
          Lojinha
        </Link>
        <Link to="/" className="text-sm text-gray-600 hover:text-black">
          Galeria
        </Link>
        {isAuthenticated && (
          <Link
            to="/dashboard"
            className="text-sm text-gray-600 hover:text-black"
          >
            Dashboard
          </Link>
        )}
        <div className="ml-auto">
          {isAuthenticated ? (
            <button
              onClick={handleLogout}
              className="text-sm text-gray-600 hover:text-black"
            >
              Sair
            </button>
          ) : (
            <Link
              to="/login"
              className="text-sm text-gray-600 hover:text-black"
            >
              Entrar
            </Link>
          )}
        </div>
      </nav>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
