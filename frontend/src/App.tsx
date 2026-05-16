import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Gallery from './pages/Gallery'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { ErrorBoundary } from './components/ErrorBoundary'

// Code splitting: Login, Dashboard e Viewer só carregam quando o
// usuário navega pra essas rotas. A Galeria fica eager porque é o
// destino do path "/" — o usuário SEMPRE entra por ela, lazy não
// traria ganho.
//
// Viewer é especialmente importante manter LAZY: ele puxa three.js +
// R3F + drei (~300 kB minified). Não pode entrar no chunk inicial sob
// nenhuma circunstância — quem só abre a galeria não deve baixar isso.
//
// Vite gera chunks separados a partir desses imports dinâmicos
// automaticamente — sem precisar configurar manualSplits.
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Viewer = lazy(() => import('./pages/Viewer'))
const AssetDetail = lazy(() => import('./pages/AssetDetail'))

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
          {/* /viewer: rota de teste para o ModelViewer. Publica para
              facilitar a validação visual do pipeline 3D; quando virar
              parte do detalhe de asset, pode sair. */}
          <Route
            path="/viewer"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Viewer />
              </Suspense>
            }
          />
          {/* /asset/:id: página de detalhe pública. Lazy porque
              compartilha o mesmo bundle pesado do ModelViewer (R3F). */}
          <Route
            path="/asset/:id"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AssetDetail />
              </Suspense>
            }
          />
          {/* Catch-all: caminho desconhecido volta pra galeria. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  )
}
