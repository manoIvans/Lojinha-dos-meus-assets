import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { CartProvider } from './cart/CartContext'
import { FavoritesProvider } from './favorites/FavoritesContext'
import { NotificationsProvider } from './notifications/NotificationsContext'
import { ToastProvider } from './components/Toast'
import App from './App'
import './index.css'

// Ordem dos providers importa:
//   BrowserRouter (rotas)
//     → AuthProvider (estado de auth)
//       → ToastProvider (notificações; qualquer página consome)
//         → FavoritesProvider (depende de useAuth)
//           → CartProvider (depende de useAuth)
//             → App
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <FavoritesProvider>
            <CartProvider>
              <NotificationsProvider>
                <App />
              </NotificationsProvider>
            </CartProvider>
          </FavoritesProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
