import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api, type Asset } from '../api/client'
import { toCents } from '../lib/money'
import { parseTags } from '../lib/tags'
import { PIXEL_BTN, PIXEL_INPUT } from '../styles/pixel'
import { useToast } from '../components/Toast'

// Dashboard: formulário de upload protegido (/dashboard, atrás do
// ProtectedRoute). Bate em POST /api/v1/assets com FormData — o api
// helper detecta FormData e OMITE o Content-Type para que o navegador
// escreva o multipart boundary correto.

const SUCCESS_DISMISS_MS = 5000

// FILE_INPUT é local porque só o Dashboard tem upload combinado de
// thumbnail + modelo. Quando AssetEdit também usar input estilizado,
// vale extrair pra src/styles/pixel.ts.
const FILE_INPUT =
  'mt-1 block w-full text-xs font-mono ' +
  'file:mr-3 file:border-4 file:border-ink file:bg-arcane file:text-parchment ' +
  'file:px-3 file:py-1.5 file:text-xs file:font-bold file:uppercase file:tracking-wider ' +
  'hover:file:bg-ink'

export default function Dashboard() {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // tagsInput é o texto cru digitado pelo usuário (separadores
  // ',' ou newline). Convertido pra array no submit via parseTags.
  // Manter como string em vez de array no estado deixa o input
  // ser controlado normalmente como qualquer outro <input>.
  const [tagsInput, setTagsInput] = useState('')
  const [price, setPrice] = useState('')
  const [thumbnail, setThumbnail] = useState<File | null>(null)
  const [model, setModel] = useState<File | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Asset | null>(null)

  // Banner de sucesso some sozinho depois de 5s. Reset do timer quando
  // `created` muda (upload novo enquanto o anterior ainda visível).
  useEffect(() => {
    if (!created) return
    const t = setTimeout(() => setCreated(null), SUCCESS_DISMISS_MS)
    return () => clearTimeout(t)
  }, [created])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!thumbnail || !model) {
      setError('Selecione thumbnail e modelo')
      return
    }
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

    // FormData faz o multipart "automaticamente": cada append vira
    // uma part do request, com Content-Disposition correto. Tags
    // viram MÚLTIPLAS parts com o mesmo nome — o Gin lê com
    // c.PostFormArray("tags").
    const form = new FormData()
    form.append('title', title)
    form.append('description', description)
    for (const t of tags) {
      form.append('tags', t)
    }
    form.append('price_cents', String(priceCents))
    form.append('thumbnail', thumbnail)
    form.append('model', model)

    try {
      const asset = await api.post<Asset>('/api/v1/assets', form)
      setCreated(asset)
      resetForm()
    } catch (err) {
      // Erros do backend (4xx/5xx/rede) viram toast — não apontam pra
      // um campo específico do form. Validação local (acima) continua
      // no banner inline porque indica qual campo corrigir.
      toast.error(messageFor(err))
    } finally {
      setSubmitting(false)
    }
  }

  function resetForm() {
    setTitle('')
    setDescription('')
    setTagsInput('')
    setPrice('')
    setThumbnail(null)
    setModel(null)
    // <input type="file"> não respeita value controlado por React
    // (restrição de segurança). Reset via DOM é a única forma.
    document
      .querySelectorAll<HTMLInputElement>('input[type="file"]')
      .forEach((el) => {
        el.value = ''
      })
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="bg-parchment border-4 border-ink shadow-pixel">
        <h1 className="bg-arcane text-parchment text-sm font-bold uppercase tracking-widest border-b-4 border-ink px-4 py-3">
          ▶ Publicar Asset
        </h1>

        <div className="p-6">
          <Callouts
            created={created}
            error={error}
            onDismiss={() => setError(null)}
          />

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field
              label="Título"
              required
              maxLength={200}
              value={title}
              onChange={setTitle}
            />

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

            <Field
              label="Tags (separadas por vírgula)"
              required
              placeholder="3D, low-poly, fantasia"
              value={tagsInput}
              onChange={setTagsInput}
            />

            <Field
              label="Preço (R$)"
              required
              placeholder="29,90"
              inputMode="decimal"
              value={price}
              onChange={setPrice}
            />

            <FileField
              label="Thumbnail (.png, .jpg)"
              accept=".png,.jpg,.jpeg"
              required
              onChange={setThumbnail}
            />

            <FileField
              label="Modelo 3D (.glb, .gltf)"
              accept=".glb,.gltf"
              required
              onChange={setModel}
            />

            <button
              type="submit"
              disabled={submitting}
              className={`${PIXEL_BTN} w-full bg-arcane text-parchment text-sm mt-2`}
            >
              {submitting ? '...' : '▶ Publicar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

// --- Subcomponentes locais ---------------------------------------------------

type FieldProps = {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  maxLength?: number
  placeholder?: string
  inputMode?: 'decimal' | 'text'
}

function Field({ label, value, onChange, ...rest }: FieldProps) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wider">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={PIXEL_INPUT}
        {...rest}
      />
    </label>
  )
}

type FileFieldProps = {
  label: string
  accept: string
  required?: boolean
  onChange: (file: File | null) => void
}

function FileField({ label, accept, required, onChange }: FileFieldProps) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wider">
        {label}
      </span>
      <input
        type="file"
        accept={accept}
        required={required}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className={FILE_INPUT}
      />
    </label>
  )
}

// Callouts no estilo "item obtido!" (sucesso, verde musgo) e
// "comando inválido!" (erro, madeira/marrom). Ambos com shadow-pixel
// para combinar com o resto da UI.
function Callouts({
  created,
  error,
  onDismiss,
}: {
  created: Asset | null
  error: string | null
  onDismiss: () => void
}) {
  if (!created && !error) return null
  return (
    <div className="mb-6 space-y-3">
      {created && (
        <div
          role="status"
          className="bg-arcane text-parchment border-4 border-ink shadow-pixel p-4"
        >
          <p className="text-sm font-bold uppercase tracking-widest">
            ★ Publicado!
          </p>
          <p className="text-xs mt-1">
            Asset #{created.id} —{' '}
            <span className="italic">“{created.title}”</span>
          </p>
          <Link
            to="/"
            className="mt-2 inline-block text-xs font-bold uppercase tracking-wider underline underline-offset-4 decoration-2 hover:text-parchment/80"
          >
            ▶ Ver no catálogo
          </Link>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="bg-ink text-parchment border-4 border-ink shadow-pixel p-4 flex items-start justify-between gap-3"
        >
          <span className="text-sm font-bold uppercase tracking-wider">
            ✗ {error}
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Fechar"
            className="font-bold text-lg leading-none hover:text-parchment/80"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

// --- Helpers -----------------------------------------------------------------

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | string
    if (typeof body === 'object' && body?.error) return body.error
    if (err.status === 401) return 'Sessão expirada'
    if (err.status === 413) return 'Arquivo grande demais'
    if (err.status === 415) return 'Tipo de arquivo inválido'
  }
  return 'Falha ao publicar'
}
