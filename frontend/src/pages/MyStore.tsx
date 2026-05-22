import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Asset, type SellerStats } from '../api/client'
import { formatDate, formatPrice } from '../lib/format'
import { ASSET_GRID_CLASSES } from '../styles/pixel'
import AssetCard from '../components/AssetCard'
import AssetCardSkeleton from '../components/AssetCardSkeleton'

// Minha Loja: lista APENAS os assets cujo owner_id é o do usuário
// logado. Backend já faz o filtro (GET /api/v1/my/assets) — o front
// só renderiza. Mesmo card da Galeria é reutilizado: clicar leva pra
// /asset/:id onde o OwnerPanel já oferece Editar/Deletar.
//
// Estados (mesma discriminação implícita usada em Gallery):
//   assets === null + error === null  → loading (skeletons)
//   assets === null + error           → erro com retry
//   assets === []   + error === null  → loja vazia (CTA pro Dashboard)
//   assets:Asset[]  + error === null  → grid de cards

const SKELETON_COUNT = 4

export default function MyStore() {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  // stats vem do GET /my/store/stats em paralelo com /my/assets.
  // Falha silenciosa: o dashboard some, mas o grid de assets ainda
  // funciona. null = ainda carregando.
  const [stats, setStats] = useState<SellerStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    setAssets(null)
    setStats(null)
    let cancelled = false

    api
      .get<Asset[]>('/api/v1/my/assets')
      .then((data) => {
        if (!cancelled) setAssets(data)
      })
      .catch(() => {
        if (!cancelled) setError('Falha ao carregar sua loja.')
      })

    api
      .get<SellerStats>('/api/v1/my/store/stats')
      .then((data) => {
        if (!cancelled) setStats(data)
      })
      .catch(() => {
        // stats é nice-to-have; falha silenciosa esconde a sessão.
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = load()
    return cancel
  }, [load])

  // Stats sessão aparece quando: (1) tem stats carregado, (2) tem
  // pelo menos uma venda. Loja vazia ou sem vendas ainda esconde
  // pra não ocupar espaço com "0 vendas".
  const showStats = stats !== null && stats.total_sales > 0

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <Hero count={error ? null : assets?.length ?? null} loading={!error && assets === null} />
      {showStats && <StatsSection stats={stats} />}
      <Content assets={assets} error={error} onRetry={load} />
    </div>
  )
}

// StatsSection: card com 3 métricas grandes em cima + bloco do top
// asset + lista de últimas vendas. Layout responsivo (3 col → 2 col
// → 1 col em mobile).
function StatsSection({ stats }: { stats: SellerStats }) {
  return (
    <section className="bg-parchment border-4 border-ink shadow-pixel">
      <h2 className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
        ▶ Estatísticas da Loja
      </h2>
      <div className="p-6 space-y-6">
        {/* Métricas principais. 3 colunas em desktop, empilha em
            mobile via grid-cols-1 → md:grid-cols-3. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Metric
            label="Vendas"
            value={String(stats.total_sales)}
          />
          <Metric
            label="Receita"
            value={`✦ ${formatPrice(stats.revenue_cents)}`}
          />
          <Metric
            label="Compradores únicos"
            value={String(stats.unique_buyers)}
          />
        </div>

        {/* Top asset: card destacado com bg-twilight (mesma vibe
            do "preço" no AssetDetail). Vira link pro detalhe. */}
        {stats.top_asset && (
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest mb-2 text-ink/60">
              ▸ Asset mais vendido
            </h3>
            <Link
              to={`/asset/${stats.top_asset.asset_id}`}
              className="
                block bg-twilight text-parchment border-4 border-ink shadow-pixel
                px-4 py-3
                transition-all duration-75 ease-out
                hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
              "
            >
              <p className="text-sm font-bold uppercase tracking-wider truncate">
                {stats.top_asset.title}
              </p>
              <p className="text-[10px] uppercase tracking-widest text-parchment/70 mt-1">
                {stats.top_asset.sales}{' '}
                {stats.top_asset.sales === 1 ? 'venda' : 'vendas'}
              </p>
            </Link>
          </div>
        )}

        {/* Últimas vendas: tabela enxuta, 1 linha por compra. Limit
            10 no backend. Quem clica num título vai pro detalhe. */}
        {stats.recent_sales.length > 0 && (
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest mb-2 text-ink/60">
              ▸ Últimas vendas
            </h3>
            <ul className="space-y-2">
              {stats.recent_sales.map((s) => (
                <li
                  key={s.purchase_id}
                  className="border-2 border-ink/20 px-3 py-2 flex flex-wrap items-center gap-3 text-xs"
                >
                  <Link
                    to={`/asset/${s.asset_id}`}
                    className="font-bold uppercase tracking-wider truncate flex-1 min-w-0 hover:text-arcane hover:underline underline-offset-4 decoration-2"
                    title={s.asset_title}
                  >
                    {s.asset_title}
                  </Link>
                  <Link
                    to={`/u/${s.buyer_username}`}
                    className="text-ink/70 hover:text-arcane truncate"
                  >
                    por {s.buyer_display_name}
                  </Link>
                  <span className="font-bold">
                    ✦ {formatPrice(s.price_cents_snapshot)}
                  </span>
                  <span className="text-[10px] text-ink/60">
                    {formatDate(s.purchased_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

// Metric: card pequeno com label uppercase + valor grande. Reusado
// pras 3 métricas top.
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink text-parchment border-4 border-ink shadow-pixel-sm px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-parchment/60">
        {label}
      </p>
      <p className="text-xl font-bold mt-1 truncate">{value}</p>
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
        ▶ Minha Loja
      </p>
      <div className="px-6 py-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
            Forja do Aventureiro
          </h1>
          <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
            ▸ {subtitle(count, loading)}
          </p>
        </div>
        {/* CTA pro Dashboard pra publicar novo asset. Estilo "botão
            pixel completo" pra destacar a ação principal da página. */}
        <Link
          to="/dashboard"
          className="
            inline-block bg-arcane text-parchment border-4 border-ink shadow-pixel
            px-4 py-2 text-xs font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ▶ Publicar novo
        </Link>
      </div>
    </header>
  )
}

function subtitle(count: number | null, loading: boolean): string {
  if (loading) return 'Carregando sua loja...'
  if (count === null) return 'Falha ao carregar'
  if (count === 0) return 'Nenhum asset publicado ainda'
  if (count === 1) return '1 asset na sua loja'
  return `${count} assets na sua loja`
}

function Content({
  assets,
  error,
  onRetry,
}: {
  assets: Asset[] | null
  error: string | null
  onRetry: () => void
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
      <div className={ASSET_GRID_CLASSES} aria-busy="true" aria-live="polite">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <AssetCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (assets.length === 0) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center">
        <p className="text-5xl mb-4" aria-hidden="true">
          ⚒
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Sua loja está vazia
        </p>
        <p className="text-xs text-ink/70 tracking-wider mb-6">
          Publique seu primeiro asset e comece a aventurar-se!
        </p>
        <Link
          to="/dashboard"
          className="
            inline-block bg-arcane text-parchment border-4 border-ink shadow-pixel
            px-4 py-2 text-xs font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ▶ Publicar agora
        </Link>
      </div>
    )
  }

  return (
    <div className={ASSET_GRID_CLASSES}>
      {assets.map((asset, i) => (
        <AssetCard key={asset.id} asset={asset} priority={i < 4} />
      ))}
    </div>
  )
}
