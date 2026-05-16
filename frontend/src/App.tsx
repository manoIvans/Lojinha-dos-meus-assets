import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Gallery from './pages/Gallery'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { ErrorBoundary } from './components/ErrorBoundary'

// Code splitting: Login e Dashboard só carregam quando o usuário
// navega pra essas rotas. A Galeria fica eager porque é o destino do
// path "/" — o usuário SEMPRE entra por ela, lazy não traria ganho.
//
// Vite gera chunks separados a partir desses imports dinâmicos
// automaticamente — sem precisar configurar manualSplits.
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))

// Fallback minimalista enquanto o chunk da rota carrega. Vazio de
// propósito: em rede normal o chunk vem em ~50-100ms e qualquer
// spinner aqui só "pisca" e atrapalha mais que ajuda. Se a rede
// piorar muito, troca por um skeleton específico da rota.
const RouteFallback = () => null

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Gallery />} />
          <Route
            path="/login"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Login />
              </Suspense>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Suspense fallback={<RouteFallback />}>
                  <Dashboard />
                </Suspense>
              </ProtectedRoute>
            }
          />
          {/* Catch-all: caminho desconhecido volta pra galeria. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  )
}
