import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api, fileUrl, type Asset } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import Avatar from '../components/Avatar'
import { useToast } from '../components/Toast'
import ModelViewer from '../components/ModelViewer'

// AssetDetail (/asset/:id): página de detalhe do asset.
//
// Layout em três blocos verticais:
//   1. Back link (◀ Voltar à galeria) — pequeno, no topo
//   2. Hero card — título grande + autor + #id + data
//   3. Grid 2/3 + 1/3 (no desktop) — Viewer + Info
//   4. (SE for dono) OwnerPanel com botões de editar/excluir
//
// Três variáveis de estado de propósito não-mutuamente-exclusivas:
//   - loading: fetch em andamento
//   - notFound: 404 do backend (asset deletado ou nunca existiu)
//   - error: rede/5xx/etc
// Diferenciar 404 de erro genérico permite copy distinto.
export default function AssetDetail() {
  const { id } = useParams<{ id: string }>()
  const [asset, setAsset] = useState<Asset | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) {
      setNotFound(true)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setNotFound(false)
    setError(null)

    api
      .get<Asset>(`/api/v1/assets/${id}`)
      .then((a) => {
        if (cancelled) return
        setAsset(a)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true)
        } else {
          setError('Falha ao carregar o asset')
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <LoadingState />
  if (notFound) return <NotFoundState />
  if (error || !asset)
    return <ErrorState message={error ?? 'Erro desconhecido'} />

  return <Detail asset={asset} />
}

function Detail({ asset }: { asset: Asset }) {
  const { currentUserId } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  // Comparação só faz sentido se o usuário estiver logado E o asset
  // tiver owner_id (que sempre tem). isOwner controla a renderização
  // do OwnerPanel — backend ainda valida ownership em toda mutação
  // de qualquer jeito.
  const isOwner =
    currentUserId !== null && currentUserId === asset.owner_id

  async function handleDelete() {
    try {
      await api.delete(`/api/v1/assets/${asset.id}`)
      // Toast antes do navigate: o ToastProvider vive ACIMA das rotas,
      // então sobrevive à desmontagem dessa página.
      toast.success(`"${asset.title}" excluído`)
      navigate('/', { replace: true })
    } catch (err) {
      // OwnerPanel devolve o usuário ao estado pré-confirm via re-throw
      // (catch interno). Aqui só sinalizamos a falha pro usuário e
      // logamos pra debugar depois.
      console.error('delete asset:', err)
      toast.error(messageForDelete(err))
      throw err
    }
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <Link
        to="/"
        className="inline-block text-xs font-bold uppercase tracking-widest text-parchment hover:underline underline-offset-4 decoration-2"
      >
        ◀ Voltar à galeria
      </Link>

      <header className="bg-parchment border-4 border-ink shadow-pixel">
        <p className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
          ▶ Asset #{asset.id}
        </p>
        <div className="px-6 py-5 space-y-3">
          <h1 className="text-2xl md:text-3xl font-bold uppercase tracking-wider break-words leading-tight">
            {asset.title}
          </h1>
          {/* Linha do autor com avatar + link clicável pro perfil
              público. Quando author_username está presente (sempre,
              em respostas com JOIN), vira <Link>; quando ausente
              (legacy/edge case), fica só texto. */}
          <div className="flex flex-wrap items-center gap-3">
            <Avatar
              avatarPath={asset.author_avatar_path}
              name={asset.author_name ?? '?'}
              size="sm"
            />
            <div className="text-xs uppercase tracking-widest flex flex-wrap items-center gap-x-3 gap-y-1">
              {asset.author_username ? (
                <Link
                  to={`/u/${asset.author_username}`}
                  className="font-bold hover:underline underline-offset-4 decoration-2 hover:text-arcane"
                >
                  {asset.author_name ?? asset.author_username}
                </Link>
              ) : (
                <span className="font-bold">
                  {asset.author_name ?? 'anônimo'}
                </span>
              )}
              <span aria-hidden="true" className="text-ink/30">
                │
              </span>
              <span>{formatDate(asset.created_at)}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2">
          <div className="bg-parchment border-4 border-ink shadow-pixel">
            <h2 className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
              ▶ Visualizador
            </h2>
            <div className="p-4">
              <ModelViewer
                modelUrl={fileUrl(asset.model_path)}
                className="w-full aspect-square bg-twilight border-4 border-ink"
              />
              <p className="mt-3 text-xs uppercase tracking-wider text-ink/70">
                ▌ Arraste pra orbitar · scroll pra zoom · botão direito
                pra mover
              </p>
            </div>
          </div>
        </section>

        <aside>
          <div className="bg-parchment border-4 border-ink shadow-pixel">
            <h2 className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
              ▶ Info
            </h2>

            <div className="p-6 space-y-5">
              <div className="bg-twilight text-parchment border-4 border-ink shadow-pixel-sm px-4 py-3 text-center">
                <p className="text-[10px] uppercase tracking-widest text-parchment/70">
                  Preço
                </p>
                <p className="text-2xl font-bold mt-1">
                  ✦ {formatPrice(asset.price_cents)}
                </p>
              </div>

              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest mb-2 text-ink/60">
                  ▸ Descrição
                </h3>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {asset.description.trim() || (
                    <span className="text-ink/40">— sem descrição —</span>
                  )}
                </p>
              </div>

              {/* Tags multi-valor (migration 004). flex-wrap permite
                  quebrar linha em modelos com várias. Se vier vazio
                  (anomalia, schema garante NOT NULL DEFAULT '{}'),
                  mostramos placeholder discreto. */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest mb-2 text-ink/60">
                  ▸ Tags
                </h3>
                {asset.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {asset.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-block bg-arcane text-parchment text-[10px] px-2 py-1 uppercase tracking-widest font-bold"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-ink/40">— sem tags —</p>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* OwnerPanel só aparece quando o usuário logado é o dono. UI
          gate aqui; backend valida ownership em PUT/DELETE de qualquer
          jeito (ErrAssetForbidden → 403). */}
      {isOwner && <OwnerPanel asset={asset} onConfirmDelete={handleDelete} />}
    </div>
  )
}

// OwnerPanel: ações destrutivas isoladas num card próprio, fora do
// painel de Info. Exclusão tem confirm inline (estado local) em vez
// de window.confirm() — preserva a estética pixel-art e não quebra
// o usuário com um dialog nativo do navegador.
function OwnerPanel({
  asset,
  onConfirmDelete,
}: {
  asset: Asset
  onConfirmDelete: () => void | Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleConfirm() {
    setDeleting(true)
    try {
      await onConfirmDelete()
      // Sem reset de state — em caso de sucesso a página será
      // desmontada via navigate('/').
    } catch {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <section>
      <div className="bg-parchment border-4 border-ink shadow-pixel">
        <h2 className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
          ▶ Zona do dono
        </h2>
        <div className="p-6">
          {confirming ? (
            <div className="space-y-4">
              <p className="text-sm">
                <span className="font-bold uppercase tracking-widest">
                  ✗ Excluir?
                </span>{' '}
                Você vai remover permanentemente{' '}
                <span className="italic">“{asset.title}”</span>. Esta
                ação não pode ser desfeita.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={deleting}
                  className="
                    bg-ink text-parchment border-4 border-ink shadow-pixel
                    px-4 py-2 text-xs font-bold uppercase tracking-widest
                    transition-all duration-75 ease-out
                    hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
                    disabled:opacity-50 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-pixel
                  "
                >
                  {deleting ? '...' : '✗ Sim, excluir'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                  className="
                    bg-parchment text-ink border-4 border-ink shadow-pixel
                    px-4 py-2 text-xs font-bold uppercase tracking-widest
                    transition-all duration-75 ease-out
                    hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
                    disabled:opacity-50
                  "
                >
                  ◀ Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={`/asset/${asset.id}/edit`}
                className="
                  bg-arcane text-parchment border-4 border-ink shadow-pixel
                  px-4 py-2 text-xs font-bold uppercase tracking-widest
                  transition-all duration-75 ease-out
                  hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
                "
              >
                ▶ Editar
              </Link>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="
                  bg-parchment text-ink border-4 border-ink shadow-pixel
                  px-4 py-2 text-xs font-bold uppercase tracking-widest
                  transition-all duration-75 ease-out
                  hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
                "
              >
                ✗ Excluir
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function LoadingState() {
  return (
    <div className="max-w-md mx-auto mt-16 p-6">
      <div className="bg-parchment border-4 border-ink shadow-pixel p-8 text-center">
        <p className="text-4xl mb-4 animate-pulse" aria-hidden="true">
          ▌
        </p>
        <p className="text-sm font-bold uppercase tracking-widest">
          Carregando dados do projeto...
        </p>
      </div>
    </div>
  )
}

function NotFoundState() {
  return (
    <div className="max-w-md mx-auto mt-16 p-6">
      <div className="bg-parchment border-4 border-ink shadow-pixel p-8 text-center">
        <p className="text-4xl mb-4" aria-hidden="true">
          ✗
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Asset não encontrado
        </p>
        <p className="text-xs text-ink/70 tracking-wider mb-6">
          O ID solicitado não existe no catálogo.
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
          ◀ Voltar à galeria
        </Link>
      </div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="max-w-md mx-auto mt-16 p-6">
      <div className="bg-ink text-parchment border-4 border-ink shadow-pixel p-8 text-center">
        <p className="text-4xl mb-4" aria-hidden="true">
          ✗
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-6">
          {message}
        </p>
        <Link
          to="/"
          className="
            inline-block bg-parchment text-ink border-4 border-ink shadow-pixel
            px-4 py-2 text-xs font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ◀ Galeria
        </Link>
      </div>
    </div>
  )
}

function messageForDelete(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Sessão expirada'
    if (err.status === 403) return 'Este asset não é seu'
    if (err.status === 404) return 'Asset já foi removido'
  }
  return 'Falha ao excluir o asset'
}

const priceFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function formatPrice(cents: number): string {
  return priceFormatter.format(cents / 100)
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso))
}
