import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Gallery from './pages/Gallery'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import { ProtectedRoute } from './auth/ProtectedRoute'

// Mapa de rotas. Layout é route element pai para que a navbar fique
// renderizada em todas as páginas sem que cada uma precise importá-la.
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Gallery />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        {/* Catch-all: caminho desconhecido volta pra galeria. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
