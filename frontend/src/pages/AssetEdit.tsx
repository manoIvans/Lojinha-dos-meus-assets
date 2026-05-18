import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api, type Asset } from '../api/client'
import { useAuth } from '../auth/AuthContext'

// AssetEdit (/asset/:id/edit): formulário de edição dos metadados de
// um asset existente. Só edita texto/preço — arquivos (thumbnail e
// modelo 3D) são imutáveis nesta versão; pra trocar, exclui + republica.
//
// Fluxo:
//   1. Lê :id da URL
//   2. Fetch GET /api/v1/assets/:id (público)
//   3. Confere ownership client-side (currentUserId vs owner_id):
//      - Se não é dono → redireciona pra /asset/:id (read-only)
//      - Se é dono → mostra form pré-populado
//   4. Submit: PUT /api/v1/assets/:id (JSON, protegido)
//   5. Em sucesso → navega pra /asset/:id (rota de detalhe atualizada)
//
// Ownership client-side é APENAS UX/redirecionamento — o backend
// rejeita PUT/DELETE de quem não é dono (ErrAssetForbidden → 403).

const PIXEL_INPUT =
  'mt-1 block w-full bg-white text-ink border-4 border-ink px-3 py-2 ' +
  'font-mono focus:outline-none focus:shadow-pixel-sm'

const PIXEL_BTN =
  'border-4 border-ink shadow-pixel px-4 py-2 font-bold uppercase tracking-widest ' +
  'transition-all duration-75 ease-out ' +
  'hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none ' +
  'disabled:opacity-50 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-pixel'

export default function AssetEdit() {
  const { id } = useParams<{ id: string }>()
  const { currentUserId } = useAuth()
  const [asset, setAsset] = useState<Asset | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) {
      setLoadError('ID inválido')
      setLoading(false)
      return
    }

    let cancelled = false
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
          setLoadError('Asset não encontrado')
        } else {
          setLoadError('Falha ao carregar')
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <LoadingState />
  if (loadError || !asset) return <ErrorState message={loadError ?? 'Erro'} />

  // Gate de ownership client-side. Não-donos não veem o form — vão
  // direto pra rota de leitura. replace=true evita poluir o histórico.
  if (currentUserId !== asset.owner_id) {
    return <Navigate to={`/asset/${asset.id}`} replace />
  }

  return <EditForm asset={asset} />
}

function EditForm({ asset }: { asset: Asset }) {
  const navigate = useNavigate()

  const [title, setTitle] = useState(asset.title)
  const [description, setDescription] = useState(asset.description)
  const [category, setCategory] = useState(asset.category)
  const [price, setPrice] = useState(fromCents(asset.price_cents))

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const priceCents = toCents(price)
    if (priceCents === null) {
      setError('Preço inválido')
      return
    }
    setSubmitting(true)
    setError(null)

    try {
      // PUT é JSON puro (não multipart) — Update no backend só recebe
      // os 4 campos de texto. Files ficam intocados.
      await api.put<Asset>(`/api/v1/assets/${asset.id}`, {
        title,
        description,
        category,
        price_cents: priceCents,
      })
      navigate(`/asset/${asset.id}`, { replace: true })
    } catch (err) {
      setError(messageFor(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <Link
        to={`/asset/${asset.id}`}
        className="inline-block mb-4 text-xs font-bold uppercase tracking-widest text-parchment hover:underline underline-offset-4 decoration-2"
      >
        ◀ Voltar ao asset
      </Link>

      <div className="bg-parchment border-4 border-ink shadow-pixel">
        <h1 className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
          ▶ Editar Asset #{asset.id}
        </h1>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div
              role="alert"
              className="bg-ink text-parchment border-4 border-ink shadow-pixel-sm p-3 text-xs font-bold uppercase tracking-wider"
            >
              ✗ {error}
            </div>
          )}

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider">
              Título
            </span>
            <input
              type="text"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={PIXEL_INPUT}
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider">
              Descrição
            </span>
            <textarea
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={PIXEL_INPUT}
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider">
              Categoria
            </span>
            <input
              type="text"
              required
              maxLength={50}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={PIXEL_INPUT}
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider">
              Preço (R$)
            </span>
            <input
              type="text"
              inputMode="decimal"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={PIXEL_INPUT}
            />
          </label>

          {/* Aviso sobre o que NÃO é editável aqui — UX honesta. */}
          <p className="text-[10px] uppercase tracking-wider text-ink/60 border-t-4 border-ink pt-3">
            ▸ Thumbnail e modelo 3D não podem ser alterados. Pra trocar
            o arquivo, exclua e republique.
          </p>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className={`${PIXEL_BTN} bg-arcane text-parchment text-sm flex-1`}
            >
              {submitting ? '...' : '▶ Salvar'}
            </button>
            <Link
              to={`/asset/${asset.id}`}
              className={`${PIXEL_BTN} bg-parchment text-ink text-sm`}
            >
              ◀ Cancelar
            </Link>
          </div>
        </form>
      </div>
    </div>
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
          Carregando...
        </p>
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

// toCents aceita "12", "12.90", "12,90". null pra qualquer coisa
// fora disso. Mesma lógica do Dashboard — quando virar 3º consumer,
// extrair pra src/lib/money.ts.
function toCents(raw: string): number | null {
  const normalized = raw.replace(',', '.').trim()
  if (!normalized) return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

// fromCents é o inverso usado só na inicialização do form. Devolve
// formato "29,90" (vírgula como separador decimal) pra combinar com
// o que o usuário digitou originalmente.
function fromCents(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | string
    if (typeof body === 'object' && body?.error) return body.error
    if (err.status === 401) return 'Sessão expirada'
    if (err.status === 403) return 'Este asset não é seu'
    if (err.status === 404) return 'Asset não encontrado'
  }
  return 'Falha ao salvar'
}
