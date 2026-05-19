import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ToastProvider } from './components/Toast'
import App from './App'
import './index.css'

// Ordem dos providers importa:
//   BrowserRouter (rotas) → AuthProvider (estado de auth, sem rotas
//   dentro) → ToastProvider (notificações; precisa estar acima de App
//   pra que qualquer página consuma useToast) → App.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
