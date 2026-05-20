import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api, fileUrl, type Asset } from '../api/client'
import { useCart } from '../cart/CartContext'
import { formatPrice } from '../lib/format'
import Avatar from '../components/Avatar'
import LineSkeleton from '../components/LineSkeleton'
import { useToast } from '../components/Toast'

// /carrinho: tela final antes do checkout.
//
// Layout vertical (linha por asset) em vez de grid de cards — aqui
// o usuário não está descobrindo conteúdo, está revisando uma lista
// finita pra confirmar. Cada linha tem thumb + título + autor +
// preço + botão "remover". Embaixo: total + botão "Finalizar compra".
//
// Sincronização com CartContext: a lista local de assets vem do
// GET /my/cart; mas filtramos pelo Set do contexto pra que clicar
// "remover" some o item na hora (optimistic). Quando o context Set
// remove um ID, esse asset some daqui.

export default function Cart() {
  const navigate = useNavigate()
  const toast = useToast()
  const { ids, markPurchased } = useCart()

  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState(false)

  const load = useCallback(() => {
    setError(null)
    setAssets(null)
    let cancelled = false

    api
      .get<Asset[]>('/api/v1/my/cart')
      .then((data) => {
        if (!cancelled) setAssets(data)
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

  // visible: filtra pelo Set do CartContext pra que UI reaja
  // imediatamente a toggles do CartButton (otimistic update).
  const visible = useMemo<Asset[] | null>(() => {
    if (!assets) return null
    if (!ids) return assets
    return assets.filter((a) => ids.has(a.id))
  }, [assets, ids])

  // Total em centavos (Math integer) → formata uma vez no render.
  // Quando visible é null, total fica 0 (mostramos "..." no UI).
  const totalCents = useMemo<number>(() => {
    if (!visible) return 0
    return visible.reduce((sum, a) => sum + a.price_cents, 0)
  }, [visible])

  async function handleCheckout() {
    if (!visible || visible.length === 0) return
    setCheckingOut(true)
    try {
      const resp = await api.post<{ purchase_ids: number[] }>(
        '/api/v1/my/cart/checkout',
      )
      // markPurchased esvazia carrinho e adiciona ao "comprado".
      const purchasedAssetIDs = visible.map((a) => a.id)
      markPurchased(purchasedAssetIDs)
      toast.success(`${resp.purchase_ids.length} compra(s) realizada(s)`)
      navigate('/library', { replace: true })
    } catch (err) {
      toast.error(messageForCheckout(err))
      setCheckingOut(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <Hero
        count={error ? null : visible?.length ?? null}
        loading={!error && visible === null}
      />
      <Content
        assets={visible}
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
  error,
  onRetry,
  totalCents,
  onCheckout,
  checkingOut,
}: {
  assets: Asset[] | null
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

  if (assets === null) {
    return (
      <ul className="space-y-3" aria-busy="true" aria-live="polite">
        {Array.from({ length: 3 }).map((_, i) => (
          <LineSkeleton key={i} />
        ))}
      </ul>
    )
  }

  if (assets.length === 0) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center">
        <p className="text-5xl mb-4" aria-hidden="true">
          ⌬
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Carrinho vazio
        </p>
        <p className="text-xs text-ink/70 tracking-wider mb-6">
          Adicione assets pelo botão ⌬ no card ou na página do asset.
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
        {assets.map((asset) => (
          <CartLine key={asset.id} asset={asset} />
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

// CartLine: linha de um item no carrinho. Click no thumb/título leva
// pro detalhe; click no ✗ remove via CartContext.toggle.
//
// memo: prop `asset` é referência estável (vem do array que mudou só
// no fetch ou no toggle). Outros re-renders do pai (loading,
// checkingOut, total) não precisam cascatear aqui.
const CartLine = memo(function CartLine({ asset }: { asset: Asset }) {
  const { toggle } = useCart()

  async function handleRemove() {
    try {
      await toggle(asset.id)
    } catch {
      // CartButton/toast já trata; aqui é silent porque toggle
      // reverte o optimistic update sozinho.
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

// TotalCard: bloco fixo no fim da lista com o total e o botão
// finalizar compra. Pixel-art destaque (bg-twilight) pra ele ser
// a CTA principal da página.
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
