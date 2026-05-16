import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import App from './App'
import './index.css'

// Ordem dos providers importa:
//   BrowserRouter (rotas) → AuthProvider (estado de auth, sem rotas
//   dentro) → App (renderiza Routes). Permite que AuthProvider use
//   useNavigate se um dia precisar (ex: redirecionar em logout).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
