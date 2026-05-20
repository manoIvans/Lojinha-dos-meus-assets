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

// CartContext: gêmeo do FavoritesContext, mas pro carrinho. Mantém
// o Set de asset IDs adicionados ao carrinho do usuário.
//
// O Set não é o source-of-truth do "vai aparecer no /carrinho" —
// /carrinho busca a lista cheia (com preço, thumbnail, autor) via
// /my/cart. O Set serve só pra UI saber rapidamente "este card já
// está no carrinho?" e pra mostrar o contador no header.
//
// purchasedIds é o segundo Set que esse context expõe: assets já
// COMPRADOS pelo usuário. Backend rejeita comprar 2x; UI esconde
// o botão de carrinho quando já tem.

type CartApi = {
  ids: ReadonlySet<number> | undefined
  purchasedIds: ReadonlySet<number> | undefined
  isInCart: (assetID: number) => boolean
  isPurchased: (assetID: number) => boolean
  count: number // shortcut pra ids.size, ou 0 se loading
  toggle: (assetID: number) => Promise<void>
  // refresh força refetch dos dois sets. Usado após checkout
  // (carrinho some, compras aparecem).
  refresh: () => Promise<void>
  // markPurchased move IDs de `ids` pra `purchasedIds` localmente.
  // Usado após checkout pra evitar uma round-trip extra de refresh.
  markPurchased: (assetIDs: number[]) => void
}

const CartContext = createContext<CartApi | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [ids, setIds] = useState<Set<number> | undefined>(undefined)
  const [purchasedIds, setPurchasedIds] = useState<Set<number> | undefined>(
    undefined,
  )
  const pendingRef = useRef<Map<number, AbortController>>(new Map())

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setIds(undefined)
      setPurchasedIds(undefined)
      return
    }
    try {
      // Promise.all: busca cart-ids e library-ids em paralelo.
      // Falha individual cai num catch que esvazia (não trava UI).
      const [cartResp, libResp] = await Promise.all([
        api.get<{ ids: number[] }>('/api/v1/my/cart-ids'),
        api.get<{ ids: number[] }>('/api/v1/my/library-ids'),
      ])
      setIds(new Set(cartResp.ids))
      setPurchasedIds(new Set(libResp.ids))
    } catch {
      // Estado anterior fica. UI gracefully degrada — o usuário
      // pode continuar navegando, e refresh tenta de novo na próxima
      // navegação que dispare auth.
      setIds((prev) => prev ?? new Set())
      setPurchasedIds((prev) => prev ?? new Set())
    }
  }, [isAuthenticated])

  // Sincroniza ao autenticar/deslogar.
  useEffect(() => {
    if (!isAuthenticated) {
      setIds(undefined)
      setPurchasedIds(undefined)
      return
    }
    void refresh()
  }, [isAuthenticated, refresh])

  const isInCart = useCallback(
    (assetID: number) => ids?.has(assetID) ?? false,
    [ids],
  )
  const isPurchased = useCallback(
    (assetID: number) => purchasedIds?.has(assetID) ?? false,
    [purchasedIds],
  )

  // toggle: optimistic update + chamada real, com rollback no fail.
  // Mesma estrutura do FavoritesContext.toggle.
  const toggle = useCallback(
    async (assetID: number) => {
      if (!isAuthenticated) return

      const existing = pendingRef.current.get(assetID)
      if (existing) existing.abort()

      const wasIn = ids?.has(assetID) ?? false
      setIds((prev) => {
        const next = new Set(prev ?? [])
        if (wasIn) next.delete(assetID)
        else next.add(assetID)
        return next
      })

      const controller = new AbortController()
      pendingRef.current.set(assetID, controller)

      try {
        if (wasIn) {
          await api.delete(`/api/v1/assets/${assetID}/cart`)
        } else {
          await api.post(`/api/v1/assets/${assetID}/cart`)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setIds((prev) => {
          const next = new Set(prev ?? [])
          if (wasIn) next.add(assetID)
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

  // markPurchased: chamado pela tela de carrinho após checkout
  // bem-sucedido. Move localmente em vez de refresh por economia
  // (já temos a resposta do POST em mãos).
  const markPurchased = useCallback((assetIDs: number[]) => {
    setIds(new Set()) // checkout sempre limpa o carrinho inteiro
    setPurchasedIds((prev) => {
      const next = new Set(prev ?? [])
      for (const id of assetIDs) next.add(id)
      return next
    })
  }, [])

  const count = ids?.size ?? 0

  const value = useMemo<CartApi>(
    () => ({
      ids,
      purchasedIds,
      isInCart,
      isPurchased,
      count,
      toggle,
      refresh,
      markPurchased,
    }),
    [
      ids,
      purchasedIds,
      isInCart,
      isPurchased,
      count,
      toggle,
      refresh,
      markPurchased,
    ],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext)
  if (!ctx) {
    throw new Error('useCart precisa estar dentro de <CartProvider>')
  }
  return ctx
}
