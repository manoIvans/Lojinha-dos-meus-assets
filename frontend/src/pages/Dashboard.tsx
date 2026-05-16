import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api, type Asset } from '../api/client'

// Dashboard: formulário de upload protegido (/dashboard, atrás do
// ProtectedRoute). Bate em POST /api/v1/assets com FormData — o api
// helper detecta FormData e OMITE o Content-Type para que o navegador
// escreva o multipart boundary correto.
//
// Os campos category e price_cents continuam presentes mesmo o briefing
// citando só título/descrição: o backend valida ambos (binding gte=0
// em price, min=1 em category) e responderia 400 sem eles. Quando o
// produto resolver tornar opcionais, o handler Go é que muda primeiro.

const SUCCESS_DISMISS_MS = 5000

export default function Dashboard() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('') // string p/ aceitar "12,90" ou "12.90"
  const [thumbnail, setThumbnail] = useState<File | null>(null)
  const [model, setModel] = useState<File | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Asset | null>(null)

  // Auto-dismiss do callout de sucesso: some sozinho depois de 5s.
  // Reseta o timer toda vez que `created` muda (novo upload bem
  // sucedido enquanto o anterior ainda está visível).
  useEffect(() => {
    if (!created) return
    const t = setTimeout(() => setCreated(null), SUCCESS_DISMISS_MS)
    return () => clearTimeout(t)
  }, [created])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!thumbnail || !model) {
      setError('Selecione a thumbnail e o modelo.')
      return
    }
    const priceCents = toCents(price)
    if (priceCents === null) {
      setError('Preço inválido.')
      return
    }

    setSubmitting(true)
    setError(null)

    // FormData é o que torna o multipart "automático": cada append
    // vira uma part do request, com Content-Disposition correto pra
    // texto e arquivo. Não precisa de lib auxiliar.
    const form = new FormData()
    form.append('title', title)
    form.append('description', description)
    form.append('category', category)
    form.append('price_cents', String(priceCents))
    form.append('thumbnail', thumbnail)
    form.append('model', model)

    try {
      const asset = await api.post<Asset>('/api/v1/assets', form)
      setCreated(asset)
      resetForm()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setSubmitting(false)
    }
  }

  function resetForm() {
    setTitle('')
    setDescription('')
    setCategory('')
    setPrice('')
    setThumbnail(null)
    setModel(null)
    // Resetar os <input type="file"> exige zerar o valor via DOM —
    // controlar value de file input é restrito por segurança. Como o
    // formulário inteiro tá em estado React, o jeito mais simples é
    // resetar o <form> via ref. Aqui fazemos via reset do form do
    // event, suficiente porque resetForm é chamada DENTRO do submit.
    document
      .querySelectorAll<HTMLInputElement>('input[type="file"]')
      .forEach((el) => {
        el.value = ''
      })
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold mb-6">Publicar asset</h1>

      <Callouts created={created} error={error} onDismiss={() => setError(null)} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Título"
          required
          maxLength={200}
          value={title}
          onChange={setTitle}
        />

        <label className="block">
          <span className="text-sm font-medium">Descrição</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 focus:border-black focus:outline-none"
          />
        </label>

        <Field
          label="Categoria"
          required
          maxLength={50}
          value={category}
          onChange={setCategory}
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
          className="w-full rounded bg-black text-white py-2 font-medium disabled:opacity-50"
        >
          {submitting ? 'Enviando...' : 'Publicar'}
        </button>
      </form>
    </div>
  )
}

// --- Subcomponentes locais ---------------------------------------------------
// Mantidos no mesmo arquivo porque só fazem sentido aqui. Quando algum
// for reutilizado em outra página, sobe pra components/.

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
      <span className="text-sm font-medium">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 focus:border-black focus:outline-none"
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
      <span className="text-sm font-medium">{label}</span>
      <input
        type="file"
        accept={accept}
        required={required}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-gray-200"
      />
    </label>
  )
}

// Callouts agrupa as mensagens de sucesso/erro. Renderizadas como
// banners coloridos acima do form. Sucesso é dismissível pelo timer
// no useEffect; erro é dismissível só por reenvio (ou clique no x).
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
          className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800"
        >
          <p className="font-medium">Publicado!</p>
          <p>
            Asset #{created.id} —{' '}
            <span className="italic">“{created.title}”</span>
          </p>
          <Link
            to="/"
            className="mt-2 inline-block underline hover:text-green-900"
          >
            Ver no catálogo →
          </Link>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={onDismiss}
            className="text-red-600 hover:text-red-900"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

// --- Helpers -----------------------------------------------------------------

// toCents aceita "12", "12.90", "12,90". Retorna null para qualquer
// coisa fora disso. Suficiente para o form atual; quando precisar de
// validação séria, troca por uma lib de money.
function toCents(raw: string): number | null {
  const normalized = raw.replace(',', '.').trim()
  if (!normalized) return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

// messageFor traduz erros da API em algo legível para o usuário.
// Quando o backend devolve {error: "..."} no body, priorizamos essa
// mensagem (ela já é em português e específica). Status 4xx conhecidos
// têm fallback. Tudo o que escapa cai numa mensagem genérica.
function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | string
    if (typeof body === 'object' && body?.error) return body.error
    if (err.status === 401) return 'Sessão expirada. Entre novamente.'
    if (err.status === 413) return 'Arquivo grande demais.'
    if (err.status === 415) return 'Tipo de arquivo não suportado.'
  }
  return 'Falha ao publicar. Tente novamente.'
}
