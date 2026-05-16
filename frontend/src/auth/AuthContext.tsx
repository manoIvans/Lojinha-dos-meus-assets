import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { tokenStorage } from './tokenStorage'

type AuthState = {
  token: string | null
  isAuthenticated: boolean
  login: (token: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

// AuthProvider mantém o token em estado React e em localStorage.
// Inicializa de forma SÍNCRONA a partir do storage para evitar o
// flash de "deslogado → logado" no primeiro render quando o usuário
// já tem um token salvo.
//
// Não decodificamos o JWT aqui para checar `exp`: o backend responde
// 401 em token expirado, e a primeira request falha já dispara logout
// no helper da API. Mantém a lógica em um lugar só.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => tokenStorage.get())

  const login = useCallback((newToken: string) => {
    tokenStorage.set(newToken)
    setToken(newToken)
  }, [])

  const logout = useCallback(() => {
    tokenStorage.clear()
    setToken(null)
  }, [])

  // useMemo evita recriar o objeto a cada render. Sem isso, todo
  // consumidor de useAuth renderiza desnecessariamente.
  const value = useMemo<AuthState>(
    () => ({
      token,
      isAuthenticated: token !== null,
      login,
      logout,
    }),
    [token, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  }
  return ctx
}
