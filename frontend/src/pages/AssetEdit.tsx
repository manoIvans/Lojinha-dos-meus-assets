import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api, fileUrl, type Asset } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'

// AssetEdit (/asset/:id/edit): formulário de edição completo do dono.
// Edita metadados (título, descrição, tags, preço) E permite trocar
// thumbnail e modelo 3D opcionalmente.
//
// Fluxo:
//   1. Lê :id da URL
//   2. Fetch GET /api/v1/assets/:id (público)
//   3. Confere ownership client-side (currentUserId vs owner_id):
//      - Se não é dono → redireciona pra /asset/:id (read-only)
//      - Se é dono → mostra form pré-populado
//   4. Submit em SEQUÊNCIA:
//      a. PUT JSON dos metadados
//      b. Se um arquivo foi selecionado: PUT multipart da thumbnail
//      c. Se outro foi selecionado: PUT multipart do modelo
//      Cada passo falha isolado, com toast próprio — falha de
//      arquivo não invalida metadados já salvos.
//   5. Em sucesso → navega pra /asset/:id
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
  const toast = useToast()

  const [title, setTitle] = useState(asset.title)
  const [description, setDescription] = useState(asset.description)
  // tagsInput é string CSV para o input controlado. O array vira string
  // na inicialização (join), e volta pra array no submit (parseTags).
  const [tagsInput, setTagsInput] = useState(asset.tags.join(', '))
  const [price, setPrice] = useState(fromCents(asset.price_cents))
  // Files são opcionais — null = manter o atual; File = trocar.
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [modelFile, setModelFile] = useState<File | null>(null)

  const [submitting, setSubmitting] = useState(false)
  // Validação de form (campos vazios, preço malformado) continua inline
  // no banner — fica perto do input que o usuário precisa corrigir.
  // Erros vindos do backend (401/403/500) viram toast porque não
  // apontam pra um campo específico.
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const priceCents = toCents(price)
    if (priceCents === null) {
      setError('Preço inválido')
      return
    }
    const tags = parseTags(tagsInput)
    if (tags.length === 0) {
      setError('Pelo menos 1 tag é obrigatória')
      return
    }
    setSubmitting(true)
    setError(null)

    // Acumula sucessos/falhas pra dar feedback honesto: pode salvar
    // metadados mas falhar no upload da thumb, ou vice-versa. Não
    // queremos um único toast genérico que esconda esse cenário.
    let metadataSaved = false
    let thumbReplaced = false
    let modelReplaced = false
    let anyError = false

    try {
      await api.put<Asset>(`/api/v1/assets/${asset.id}`, {
        title,
        description,
        tags,
        price_cents: priceCents,
      })
      metadataSaved = true
    } catch (err) {
      toast.error(`Metadados: ${messageFor(err)}`)
      anyError = true
    }

    if (thumbnailFile) {
      try {
        const form = new FormData()
        form.append('thumbnail', thumbnailFile)
        await api.put<Asset>(`/api/v1/assets/${asset.id}/thumbnail`, form)
        thumbReplaced = true
      } catch (err) {
        toast.error(`Thumbnail: ${messageForFile(err)}`)
        anyError = true
      }
    }

    if (modelFile) {
      try {
        const form = new FormData()
        form.append('model', modelFile)
        await api.put<Asset>(`/api/v1/assets/${asset.id}/model`, form)
        modelReplaced = true
      } catch (err) {
        toast.error(`Modelo: ${messageForFile(err)}`)
        anyError = true
      }
    }

    // Sucesso agregado: toast resume o que foi salvo. Em qualquer
    // erro, deixa o usuário na página pra que ele possa tentar
    // só os pedaços que falharam.
    if (!anyError) {
      const parts = [
        metadataSaved && 'metadados',
        thumbReplaced && 'thumbnail',
        modelReplaced && 'modelo',
      ].filter(Boolean) as string[]
      toast.success(`Salvo: ${parts.join(' + ')}`)
      navigate(`/asset/${asset.id}`, { replace: true })
    } else {
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
              Tags (separadas por vírgula)
            </span>
            <input
              type="text"
              required
              placeholder="3D, low-poly, fantasia"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
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

          {/* Sessão de arquivos — visualmente separada dos metadados
              por um divider espesso. Os 2 inputs são INDEPENDENTES:
              o usuário pode trocar só a thumb, só o modelo, ou ambos. */}
          <div className="border-t-4 border-ink pt-4 space-y-4">
            <p className="text-[10px] uppercase tracking-wider text-ink/60">
              ▸ Trocar arquivos (opcional — deixar em branco mantém o atual)
            </p>

            <ThumbnailField
              currentPath={asset.thumbnail_path}
              file={thumbnailFile}
              onChange={setThumbnailFile}
            />

            <ModelField
              currentPath={asset.model_path}
              file={modelFile}
              onChange={setModelFile}
            />
          </div>

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

// ThumbnailField: preview da atual + input de troca. Quando uma nova
// imagem é selecionada, mostra "novo: filename.png" e botão pra
// desfazer (volta pra null = manter atual).
function ThumbnailField({
  currentPath,
  file,
  onChange,
}: {
  currentPath: string
  file: File | null
  onChange: (f: File | null) => void
}) {
  // localPreview: dataURL do File quando há arquivo novo, senão null.
  // useState com lazy init pra não criar dataURL desnecessariamente.
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    // URL.createObjectURL é mais barato que FileReader.readAsDataURL
    // e mais previsível na limpeza de memória (revokeObjectURL).
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <div>
      <span className="text-xs font-bold uppercase tracking-wider block mb-2">
        Thumbnail
      </span>
      <div className="flex items-start gap-3">
        <img
          src={preview ?? fileUrl(currentPath)}
          alt="Thumbnail atual"
          className="w-20 h-20 object-cover border-2 border-ink shadow-pixel-sm"
        />
        <div className="flex-1 space-y-1">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
            className="block w-full text-xs"
          />
          <p className="text-[10px] uppercase tracking-wider text-ink/60">
            png / jpg / webp · até 5 MiB
          </p>
          {file && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-[10px] uppercase tracking-widest font-bold underline underline-offset-4 decoration-2 hover:text-arcane"
            >
              ✗ Desfazer troca
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ModelField: contraparte pro .glb/.gltf. Sem preview gráfico (não
// dá pra renderizar 3D só pela seleção sem montar um Canvas inteiro).
// Mostra só o nome do arquivo atual e o novo, se houver.
function ModelField({
  currentPath,
  file,
  onChange,
}: {
  currentPath: string
  file: File | null
  onChange: (f: File | null) => void
}) {
  // Pega o "filename canônico" do path relativo (após o último /).
  // Útil pra UX — mas é o UUID do storage, não o nome original.
  const currentName = currentPath.split('/').pop() ?? currentPath

  return (
    <div>
      <span className="text-xs font-bold uppercase tracking-wider block mb-2">
        Modelo 3D
      </span>
      <div className="space-y-1">
        <p className="text-[10px] text-ink/60 break-all">
          atual: <span className="font-mono">{currentName}</span>
        </p>
        <input
          type="file"
          accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          className="block w-full text-xs"
        />
        <p className="text-[10px] uppercase tracking-wider text-ink/60">
          .glb / .gltf · até 100 MiB
        </p>
        {file && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[10px] uppercase tracking-widest font-bold underline underline-offset-4 decoration-2 hover:text-arcane"
          >
            ✗ Desfazer troca
          </button>
        )}
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

// parseTags: mesma lógica do Dashboard. Quando virar 3º caller,
// extrair pra src/lib/tags.ts.
function parseTags(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const piece of raw.split(/[,\n]/)) {
    const t = piece.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
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

// messageForFile diferencia erros específicos de upload de arquivo
// (413 tamanho, 415 formato). 403/404 reaproveitam o wording acima.
function messageForFile(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 413) return 'arquivo maior que o limite'
    if (err.status === 415) return 'formato não suportado'
  }
  return messageFor(err)
}
