import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { decodeJwt } from './jwt'
import { tokenStorage } from './tokenStorage'

type AuthState = {
  token: string | null
  // currentUserId é derivado do token via decode local. Pode ser null
  // se o token estiver malformado ou ausente. NÃO confiar para
  // autorização — só pra mostrar/esconder UI; o backend valida tudo.
  currentUserId: number | null
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
// Não decodificamos o JWT pra checar expiração: o backend responde
// 401 em token expirado, e o helper de API força logout no primeiro
// 401. Mantém a lógica em um lugar só.
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

  // currentUserId computado a partir do token. useMemo evita
  // re-decodificar a cada render quando o token não muda.
  const currentUserId = useMemo<number | null>(() => {
    if (!token) return null
    const payload = decodeJwt(token)
    return typeof payload?.user_id === 'number' ? payload.user_id : null
  }, [token])

  // useMemo evita recriar o objeto a cada render. Sem isso, todo
  // consumidor de useAuth renderiza desnecessariamente.
  const value = useMemo<AuthState>(
    () => ({
      token,
      currentUserId,
      isAuthenticated: token !== null,
      login,
      logout,
    }),
    [token, currentUserId, login, logout],
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
