import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

// NotificationsContext: source-of-truth da contagem de não-lidas no
// header e fonte de refresh pós-mark-all-read.
//
// Estratégia de polling: GET /my/notifications/unread-count a cada
// 60s (light query — só COUNT). Quando o documento volta a ficar
// visível (Page Visibility API), faz refetch imediato — usuário
// volta pra aba e vê estado atualizado sem esperar o próximo tick.
//
// Não usa WebSocket por simplicidade. 60s é "near-real-time" o
// suficiente pra notificações de venda/review; pra chat seria curto.

type Api = {
  // unreadCount: undefined enquanto carrega, number depois.
  unreadCount: number | undefined
  // refresh: força refetch (após mark-all-read, navegação manual,
  // ou consumidor que quer estado atualizado).
  refresh: () => Promise<void>
  // markAllRead: bate na API + zera o count localmente. Evita
  // flicker de "ainda tem 5" depois do click.
  markAllRead: () => Promise<void>
}

const Ctx = createContext<Api | null>(null)

const POLL_MS = 60_000

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [unreadCount, setUnreadCount] = useState<number | undefined>(undefined)

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setUnreadCount(undefined)
      return
    }
    try {
      const { count } = await api.get<{ count: number }>(
        '/api/v1/my/notifications/unread-count',
      )
      setUnreadCount(count)
    } catch {
      // Silencioso: falha de rede não deve gerar toast.
    }
  }, [isAuthenticated])

  const markAllRead = useCallback(async () => {
    if (!isAuthenticated) return
    try {
      await api.post('/api/v1/my/notifications/read-all')
      setUnreadCount(0)
    } catch {
      // Em caso de falha, próximo poll corrige.
    }
  }, [isAuthenticated])

  // Polling + visibility. Quando deslogado, não polla.
  useEffect(() => {
    if (!isAuthenticated) {
      setUnreadCount(undefined)
      return
    }
    void refresh() // primeira chamada imediata

    const interval = window.setInterval(refresh, POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isAuthenticated, refresh])

  const value = useMemo<Api>(
    () => ({ unreadCount, refresh, markAllRead }),
    [unreadCount, refresh, markAllRead],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNotifications(): Api {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useNotifications precisa estar dentro de <NotificationsProvider>')
  }
  return ctx
}
