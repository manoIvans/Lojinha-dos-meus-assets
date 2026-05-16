import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'

// ProtectedRoute redireciona para /login se o usuário não está
// autenticado. Guarda a rota original em `state.from` para que o
// Login possa devolver o usuário ao destino pretendido após entrar.
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return <>{children}</>
}
