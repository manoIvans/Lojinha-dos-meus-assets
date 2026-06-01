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

// CartContext: gêmeo do FavoritesContext, mas pro carrinho misto
// (assets soltos + packs). Mantém dois Sets paralelos —
//   - ids      = asset IDs adicionados como item solto
//   - packIds  = pack IDs adicionados como bundle
//
// Os Sets NÃO são source-of-truth do que aparece em `/carrinho` —
// essa página busca /my/cart pra ter os objetos cheios. O context serve
// pra UI saber rapidamente "este card já está no carrinho?" e pro
// contador no header.
//
// purchasedIds permanece um único Set de asset IDs comprados (status
// 'paid'). Itens de pack viram purchases individuais no checkout, então
// `isPurchased(assetID)` funciona uniformemente.

type CartApi = {
  ids: ReadonlySet<number> | undefined
  packIds: ReadonlySet<number> | undefined
  purchasedIds: ReadonlySet<number> | undefined
  isInCart: (assetID: number) => boolean
  isPackInCart: (packID: number) => boolean
  isPurchased: (assetID: number) => boolean
  count: number // total = assets soltos + packs
  toggle: (assetID: number) => Promise<void>
  togglePack: (packID: number) => Promise<void>
  refresh: () => Promise<void>
  // markPurchased: pós-checkout. Esvazia AMBOS os carrinhos (assets+packs)
  // e adiciona os asset IDs em purchasedIds localmente — evita refresh
  // imediato; o front consegue refletir o estado sem round-trip extra.
  markPurchased: (assetIDs: number[]) => void
}

const CartContext = createContext<CartApi | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [ids, setIds] = useState<Set<number> | undefined>(undefined)
  const [packIds, setPackIds] = useState<Set<number> | undefined>(undefined)
  const [purchasedIds, setPurchasedIds] = useState<Set<number> | undefined>(
    undefined,
  )
  const pendingAssetRef = useRef<Map<number, AbortController>>(new Map())
  const pendingPackRef = useRef<Map<number, AbortController>>(new Map())

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setIds(undefined)
      setPackIds(undefined)
      setPurchasedIds(undefined)
      return
    }
    try {
      // Endpoint atualizado: /my/cart-ids agora devolve
      // `{asset_ids, pack_ids}` em vez do antigo `{ids}`.
      const [cartResp, libResp] = await Promise.all([
        api.get<{ asset_ids: number[]; pack_ids: number[] }>(
          '/api/v1/my/cart-ids',
        ),
        api.get<{ ids: number[] }>('/api/v1/my/library-ids'),
      ])
      setIds(new Set(cartResp.asset_ids))
      setPackIds(new Set(cartResp.pack_ids))
      setPurchasedIds(new Set(libResp.ids))
    } catch {
      setIds((prev) => prev ?? new Set())
      setPackIds((prev) => prev ?? new Set())
      setPurchasedIds((prev) => prev ?? new Set())
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) {
      setIds(undefined)
      setPackIds(undefined)
      setPurchasedIds(undefined)
      return
    }
    void refresh()
  }, [isAuthenticated, refresh])

  const isInCart = useCallback(
    (assetID: number) => ids?.has(assetID) ?? false,
    [ids],
  )
  const isPackInCart = useCallback(
    (packID: number) => packIds?.has(packID) ?? false,
    [packIds],
  )
  const isPurchased = useCallback(
    (assetID: number) => purchasedIds?.has(assetID) ?? false,
    [purchasedIds],
  )

  // toggle: optimistic update + chamada real, com rollback no fail.
  const toggle = useCallback(
    async (assetID: number) => {
      if (!isAuthenticated) return
      const existing = pendingAssetRef.current.get(assetID)
      if (existing) existing.abort()

      const wasIn = ids?.has(assetID) ?? false
      setIds((prev) => {
        const next = new Set(prev ?? [])
        if (wasIn) next.delete(assetID)
        else next.add(assetID)
        return next
      })

      const controller = new AbortController()
      pendingAssetRef.current.set(assetID, controller)
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
        if (pendingAssetRef.current.get(assetID) === controller) {
          pendingAssetRef.current.delete(assetID)
        }
      }
    },
    [ids, isAuthenticated],
  )

  // togglePack: mesmo padrão de toggle, mas no namespace de packs.
  const togglePack = useCallback(
    async (packID: number) => {
      if (!isAuthenticated) return
      const existing = pendingPackRef.current.get(packID)
      if (existing) existing.abort()

      const wasIn = packIds?.has(packID) ?? false
      setPackIds((prev) => {
        const next = new Set(prev ?? [])
        if (wasIn) next.delete(packID)
        else next.add(packID)
        return next
      })

      const controller = new AbortController()
      pendingPackRef.current.set(packID, controller)
      try {
        if (wasIn) {
          await api.delete(`/api/v1/packs/${packID}/cart`)
        } else {
          await api.post(`/api/v1/packs/${packID}/cart`)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setPackIds((prev) => {
          const next = new Set(prev ?? [])
          if (wasIn) next.add(packID)
          else next.delete(packID)
          return next
        })
        throw err
      } finally {
        if (pendingPackRef.current.get(packID) === controller) {
          pendingPackRef.current.delete(packID)
        }
      }
    },
    [packIds, isAuthenticated],
  )

  const markPurchased = useCallback((assetIDs: number[]) => {
    // Checkout esvazia AMBOS os carrinhos.
    setIds(new Set())
    setPackIds(new Set())
    setPurchasedIds((prev) => {
      const next = new Set(prev ?? [])
      for (const id of assetIDs) next.add(id)
      return next
    })
  }, [])

  const count = (ids?.size ?? 0) + (packIds?.size ?? 0)

  const value = useMemo<CartApi>(
    () => ({
      ids,
      packIds,
      purchasedIds,
      isInCart,
      isPackInCart,
      isPurchased,
      count,
      toggle,
      togglePack,
      refresh,
      markPurchased,
    }),
    [
      ids,
      packIds,
      purchasedIds,
      isInCart,
      isPackInCart,
      isPurchased,
      count,
      toggle,
      togglePack,
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
