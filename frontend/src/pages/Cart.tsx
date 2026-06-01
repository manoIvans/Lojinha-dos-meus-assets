import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ApiError,
  api,
  fileUrl,
  type Asset,
  type CartResponse,
  type CheckoutSession,
  type Pack,
} from '../api/client'
import { useCart } from '../cart/CartContext'
import { formatPrice } from '../lib/format'
import Avatar from '../components/Avatar'
import LineSkeleton from '../components/LineSkeleton'
import { useToast } from '../components/Toast'

// /carrinho: revisão final antes do checkout. Suporta carrinho misto
// (assets soltos + packs) desde a Fase 2 de packs.
//
// Layout vertical (linha por item) em vez de grid de cards — usuário
// revisa lista finita pra confirmar. Cada linha tem thumb + título +
// autor + preço + botão ✗. Linhas de pack mostram contagem de items.
// Embaixo: total + botão "Finalizar".
//
// Sincronização com CartContext: filtramos pelos Sets do contexto
// (ids + packIds) pra que clicar "remover" tire o item na hora.

export default function Cart() {
  const navigate = useNavigate()
  const toast = useToast()
  const { ids, packIds, markPurchased } = useCart()

  const [data, setData] = useState<CartResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState(false)

  const load = useCallback(() => {
    setError(null)
    setData(null)
    let cancelled = false

    api
      .get<CartResponse>('/api/v1/my/cart')
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch(() => {
        if (!cancelled) setError('Falha ao carregar o carrinho.')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = load()
    return cancel
  }, [load])

  // visibleAssets/visiblePacks: filtra pelos Sets do CartContext.
  const visibleAssets = useMemo<Asset[] | null>(() => {
    if (!data) return null
    if (!ids) return data.assets
    return data.assets.filter((a) => ids.has(a.id))
  }, [data, ids])

  const visiblePacks = useMemo<Pack[] | null>(() => {
    if (!data) return null
    if (!packIds) return data.packs
    return data.packs.filter((p) => packIds.has(p.id))
  }, [data, packIds])

  const totalCents = useMemo<number>(() => {
    let t = 0
    for (const a of visibleAssets ?? []) t += a.price_cents
    for (const p of visiblePacks ?? []) t += p.price_cents
    return t
  }, [visibleAssets, visiblePacks])

  const totalItems =
    (visibleAssets?.length ?? 0) + (visiblePacks?.length ?? 0)
  const loading = !error && data === null

  async function handleCheckout() {
    if (totalItems === 0) return
    setCheckingOut(true)
    try {
      const session = await api.post<CheckoutSession>(
        '/api/v1/my/cart/checkout',
      )
      // Carrinho já foi esvaziado no backend; reflete localmente. Como
      // packs viram N purchases no confirm, não temos os asset IDs
      // exatos aqui — passar [] limpa o cart no context; purchasedIds
      // será atualizado no próximo refresh após o /confirm.
      markPurchased([])
      navigate(`/checkout/${session.id}`, { replace: true })
    } catch (err) {
      toast.error(messageForCheckout(err))
      setCheckingOut(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <Hero
        count={error ? null : loading ? null : totalItems}
        loading={loading}
      />
      <Content
        assets={visibleAssets}
        packs={visiblePacks}
        error={error}
        onRetry={load}
        totalCents={totalCents}
        onCheckout={handleCheckout}
        checkingOut={checkingOut}
      />
    </div>
  )
}

function Hero({
  count,
  loading,
}: {
  count: number | null
  loading: boolean
}) {
  return (
    <header className="bg-parchment border-4 border-ink shadow-pixel">
      <p className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
        ▶ Carrinho
      </p>
      <div className="px-6 py-5">
        <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
          ⌬ Pronto pra checkout
        </h1>
        <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
          ▸ {subtitle(count, loading)}
        </p>
      </div>
    </header>
  )
}

function subtitle(count: number | null, loading: boolean): string {
  if (loading) return 'Carregando carrinho...'
  if (count === null) return 'Falha ao carregar'
  if (count === 0) return 'Carrinho vazio'
  if (count === 1) return '1 item'
  return `${count} itens`
}

function Content({
  assets,
  packs,
  error,
  onRetry,
  totalCents,
  onCheckout,
  checkingOut,
}: {
  assets: Asset[] | null
  packs: Pack[] | null
  error: string | null
  onRetry: () => void
  totalCents: number
  onCheckout: () => void
  checkingOut: boolean
}) {
  if (error) {
    return (
      <div className="bg-ink text-parchment border-4 border-ink shadow-pixel p-8 text-center">
        <p className="text-4xl mb-4" aria-hidden="true">
          ✗
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-6">
          {error}
        </p>
        <button
          onClick={onRetry}
          className="
            bg-parchment text-ink border-4 border-ink shadow-pixel
            px-4 py-2 text-xs font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ▶ Tentar novamente
        </button>
      </div>
    )
  }

  if (assets === null || packs === null) {
    return (
      <ul className="space-y-3" aria-busy="true" aria-live="polite">
        {Array.from({ length: 3 }).map((_, i) => (
          <LineSkeleton key={i} />
        ))}
      </ul>
    )
  }

  if (assets.length === 0 && packs.length === 0) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center">
        <p className="text-5xl mb-4" aria-hidden="true">
          ⌬
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Carrinho vazio
        </p>
        <p className="text-xs text-ink/70 tracking-wider mb-6">
          Adicione assets pelo botão ⌬ no card ou compre um pack inteiro.
        </p>
        <Link
          to="/"
          className="
            inline-block bg-arcane text-parchment border-4 border-ink shadow-pixel
            px-4 py-2 text-xs font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ▶ Explorar o catálogo
        </Link>
      </div>
    )
  }

  return (
    <>
      <ul className="space-y-3">
        {packs.map((pack) => (
          <PackLine key={`pack-${pack.id}`} pack={pack} />
        ))}
        {assets.map((asset) => (
          <CartLine key={`asset-${asset.id}`} asset={asset} />
        ))}
      </ul>

      <TotalCard
        totalCents={totalCents}
        onCheckout={onCheckout}
        checkingOut={checkingOut}
      />
    </>
  )
}

const CartLine = memo(function CartLine({ asset }: { asset: Asset }) {
  const { toggle } = useCart()

  async function handleRemove() {
    try {
      await toggle(asset.id)
    } catch {
      // toggle reverte o optimistic update sozinho.
    }
  }

  return (
    <li className="bg-parchment border-4 border-ink shadow-pixel p-3 flex items-center gap-3">
      <Link to={`/asset/${asset.id}`} className="flex-shrink-0">
        <img
          src={fileUrl(asset.thumbnail_path)}
          alt={asset.title}
          className="w-16 h-16 object-cover border-2 border-ink shadow-pixel-sm"
        />
      </Link>
      <div className="flex-1 min-w-0">
        <Link
          to={`/asset/${asset.id}`}
          className="block font-bold text-sm uppercase tracking-wider truncate hover:text-arcane"
          title={asset.title}
        >
          {asset.title}
        </Link>
        <div className="flex items-center gap-2 mt-1">
          <Avatar
            avatarPath={asset.author_avatar_path}
            name={asset.author_name ?? '?'}
            size="xs"
          />
          <p className="text-xs text-ink/70 tracking-wider truncate">
            por{' '}
            <span className="font-bold">
              {asset.author_name ?? 'anônimo'}
            </span>
          </p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <p className="text-sm font-bold">✦ {formatPrice(asset.price_cents)}</p>
        <button
          type="button"
          onClick={handleRemove}
          aria-label="Remover do carrinho"
          title="Remover"
          className="text-[10px] uppercase tracking-widest font-bold underline underline-offset-4 decoration-2 hover:text-arcane"
        >
          ✗ Remover
        </button>
      </div>
    </li>
  )
})

// PackLine: linha de um pack no carrinho. Mostra contagem de items
// + preço do bundle. Click no título leva pro /pack/:id. Visualmente
// diferenciado (border-arcane) pra distinguir de assets soltos.
const PackLine = memo(function PackLine({ pack }: { pack: Pack }) {
  const { togglePack } = useCart()
  async function handleRemove() {
    try {
      await togglePack(pack.id)
    } catch {
      // togglePack reverte sozinho.
    }
  }

  // Fallback de thumb pra primeiro item se pack não tem própria.
  const thumb =
    pack.thumbnail_path ?? pack.items?.[0]?.thumbnail_path ?? null

  const itemCount = pack.items_count ?? pack.items?.length ?? 0

  return (
    <li className="bg-parchment border-4 border-arcane shadow-pixel p-3 flex items-center gap-3">
      <Link to={`/pack/${pack.id}`} className="flex-shrink-0">
        {thumb ? (
          <img
            src={fileUrl(thumb)}
            alt={pack.title}
            className="w-16 h-16 object-cover border-2 border-ink shadow-pixel-sm"
          />
        ) : (
          <div className="w-16 h-16 bg-arcane/20 border-2 border-ink shadow-pixel-sm flex items-center justify-center font-bold text-xs">
            PACK
          </div>
        )}
      </Link>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] uppercase tracking-widest text-arcane font-bold">
          ◆ Pack
        </span>
        <Link
          to={`/pack/${pack.id}`}
          className="block font-bold text-sm uppercase tracking-wider truncate hover:text-arcane"
          title={pack.title}
        >
          {pack.title}
        </Link>
        <p className="text-xs text-ink/70 tracking-wider truncate">
          {itemCount} {itemCount === 1 ? 'asset' : 'assets'} ·{' '}
          <span className="font-bold">
            {pack.author_name ?? 'anônimo'}
          </span>
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <p className="text-sm font-bold">✦ {formatPrice(pack.price_cents)}</p>
        <button
          type="button"
          onClick={handleRemove}
          aria-label="Remover pack do carrinho"
          title="Remover pack"
          className="text-[10px] uppercase tracking-widest font-bold underline underline-offset-4 decoration-2 hover:text-arcane"
        >
          ✗ Remover
        </button>
      </div>
    </li>
  )
})

function TotalCard({
  totalCents,
  onCheckout,
  checkingOut,
}: {
  totalCents: number
  onCheckout: () => void
  checkingOut: boolean
}) {
  return (
    <div className="bg-twilight text-parchment border-4 border-ink shadow-pixel p-5 flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-parchment/70">
          Total
        </p>
        <p className="text-3xl font-bold mt-1">✦ {formatPrice(totalCents)}</p>
      </div>
      <button
        type="button"
        onClick={onCheckout}
        disabled={checkingOut}
        className="
          bg-parchment text-ink border-4 border-ink shadow-pixel
          px-4 py-3 text-sm font-bold uppercase tracking-widest
          transition-all duration-75 ease-out
          hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          disabled:opacity-50 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-pixel
        "
      >
        {checkingOut ? '...' : '▶ Finalizar compra'}
      </button>
    </div>
  )
}

function messageForCheckout(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return 'Carrinho vazio'
    if (err.status === 409) {
      const body = err.body as { error?: string } | string
      if (typeof body === 'object' && body?.error) return body.error
      return 'Conflito no carrinho'
    }
  }
  return 'Falha ao finalizar a compra'
}
