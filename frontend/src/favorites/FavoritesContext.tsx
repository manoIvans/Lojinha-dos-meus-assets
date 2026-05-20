import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

// FavoritesContext: estado global do conjunto de assets favoritados
// pelo usuário logado. Por que global?
//
//   - O coração aparece em vários lugares (Gallery cards, AssetDetail,
//     /perfil, etc). Cada lugar precisa do MESMO estado.
//   - Sem isso, cada card teria que chamar /favorite-ids (N+1).
//
// API:
//   isFavorite(id)      → bool. Funciona mesmo offline (Set local).
//   toggle(id)          → promise. Faz optimistic update + POST/DELETE.
//                          Reverte o Set se a request falhar.
//
// Quando o usuário desloga, esvazia o Set automaticamente (efeito do
// `token` do AuthContext).

type FavoritesApi = {
  // ids: undefined = ainda carregando (loading inicial).
  //      Set vazio = carregou e não tem nada.
  //      Set com items = carregou e tem.
  // O front pode renderizar o coração como "indeterminado" enquanto
  // ids é undefined, evitando flicker de "vazio → cheio".
  ids: ReadonlySet<number> | undefined
  isFavorite: (assetID: number) => boolean
  toggle: (assetID: number) => Promise<void>
  // refresh força um GET pra revalidar — usado após o usuário visitar
  // outra aba/dispositivo e voltar.
  refresh: () => Promise<void>
}

const FavoritesContext = createContext<FavoritesApi | null>(null)

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [ids, setIds] = useState<Set<number> | undefined>(undefined)
  // pendingRef rastreia toggles em voo pra evitar race: se o usuário
  // clica rápido (add, remove, add), só o último estado importa.
  // Mapeamos por assetID — uma operação por asset por vez é OK.
  const pendingRef = useRef<Map<number, AbortController>>(new Map())

  // refresh: GET /my/favorite-ids. Só faz sentido se autenticado.
  // Quando desloga, esvaziamos via undefined → undefined (o effect
  // cuida do reset).
  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setIds(undefined)
      return
    }
    try {
      const resp = await api.get<{ ids: number[] }>('/api/v1/my/favorite-ids')
      setIds(new Set(resp.ids))
    } catch {
      // Falha silenciosa: deixa ids como undefined (loading) ou o
      // estado anterior. Toggle individual ainda tenta — backend é
      // a fonte da verdade.
      setIds((prev) => prev ?? new Set())
    }
  }, [isAuthenticated])

  // Sincroniza ao autenticar/deslogar. void Promise — refresh já
  // trata erros internamente.
  useEffect(() => {
    if (!isAuthenticated) {
      setIds(undefined)
      return
    }
    void refresh()
  }, [isAuthenticated, refresh])

  const isFavorite = useCallback(
    (assetID: number) => ids?.has(assetID) ?? false,
    [ids],
  )

  // toggle: optimistic update + chamada real. Em caso de erro,
  // reverte. Se outro toggle chega antes da primeira request
  // terminar, abortamos a anterior (pendingRef.controller.abort)
  // pra não bagunçar o estado.
  const toggle = useCallback(
    async (assetID: number) => {
      if (!isAuthenticated) {
        // Sem login, ignora silenciosamente. O caller (UI) só deve
        // mostrar o botão quando isAuthenticated, mas defensive.
        return
      }

      // Cancela toggle pendente do MESMO asset (caso o usuário clique
      // duas vezes rápido).
      const existing = pendingRef.current.get(assetID)
      if (existing) existing.abort()

      const wasFavorite = ids?.has(assetID) ?? false
      // Optimistic update no Set local — UI reage imediatamente.
      setIds((prev) => {
        const next = new Set(prev ?? [])
        if (wasFavorite) next.delete(assetID)
        else next.add(assetID)
        return next
      })

      // AbortController não é nativo no api.* hoje, mas guardamos
      // pro caso de migrarmos. Por enquanto só usamos como flag de
      // "ainda relevante?".
      const controller = new AbortController()
      pendingRef.current.set(assetID, controller)

      try {
        if (wasFavorite) {
          await api.delete(`/api/v1/assets/${assetID}/favorite`)
        } else {
          await api.post(`/api/v1/assets/${assetID}/favorite`)
        }
      } catch (err) {
        // Reverte o optimistic update.
        if (controller.signal.aborted) return
        setIds((prev) => {
          const next = new Set(prev ?? [])
          if (wasFavorite) next.add(assetID)
          else next.delete(assetID)
          return next
        })
        throw err
      } finally {
        if (pendingRef.current.get(assetID) === controller) {
          pendingRef.current.delete(assetID)
        }
      }
    },
    [ids, isAuthenticated],
  )

  const value = useMemo<FavoritesApi>(
    () => ({ ids, isFavorite, toggle, refresh }),
    [ids, isFavorite, toggle, refresh],
  )

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavorites(): FavoritesApi {
  const ctx = useContext(FavoritesContext)
  if (!ctx) {
    throw new Error('useFavorites precisa estar dentro de <FavoritesProvider>')
  }
  return ctx
}
