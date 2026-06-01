import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api, fileUrl, type Asset, type Pack } from '../api/client'
import { toCents } from '../lib/money'
import { useToast } from '../components/Toast'

// /dashboard/packs/new — form pra vendedor criar um pack.
//
// UI: lista os assets PRÓPRIOS (GET /my/assets) com checkbox. Seleção
// vai pro multipart `asset_ids`. Mín 2, máx 50 — validado client-side
// pra retorno cedo, com defense-in-depth no backend.
//
// Thumbnail própria é opcional. Sem upload, backend devolve null e o
// front cai pra thumb do 1º item ao mostrar.
//
// Em sucesso, navega pra /pack/:id criado.

const MIN_ITEMS = 2
const MAX_ITEMS = 50

export default function PackNew() {
  const navigate = useNavigate()
  const toast = useToast()

  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priceInput, setPriceInput] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [thumbFile, setThumbFile] = useState<File | null>(null)
  const [thumbPreview, setThumbPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoadError(null)
    setAssets(null)
    let cancelled = false
    api
      .get<Asset[]>('/api/v1/my/assets')
      .then((data) => {
        if (!cancelled) setAssets(data)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Falha ao carregar seus assets.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = load()
    return cancel
  }, [load])

  // Preview do thumbnail: revoke da URL anterior quando troca/desmonta.
  useEffect(() => {
    if (!thumbFile) {
      setThumbPreview(null)
      return
    }
    const url = URL.createObjectURL(thumbFile)
    setThumbPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [thumbFile])

  function toggle(assetID: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(assetID)) next.delete(assetID)
      else next.add(assetID)
      return next
    })
  }

  const priceCents = useMemo(() => toCents(priceInput), [priceInput])

  const canSubmit =
    title.trim().length > 0 &&
    selected.size >= MIN_ITEMS &&
    selected.size <= MAX_ITEMS &&
    priceCents !== null &&
    priceCents >= 0 &&
    !saving

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('title', title.trim())
      fd.set('description', description.trim())
      fd.set('price_cents', String(priceCents))
      for (const id of selected) fd.append('asset_ids', String(id))
      if (thumbFile) fd.set('thumbnail', thumbFile)

      const created = await api.post<Pack>('/api/v1/packs', fd)
      toast.success('Pack criado')
      navigate(`/pack/${created.id}`, { replace: true })
    } catch (err) {
      toast.error(messageForCreate(err))
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="bg-parchment border-4 border-ink shadow-pixel">
        <p className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
          ▶ Novo pack
        </p>
        <div className="px-6 py-5">
          <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
            Crie um bundle
          </h1>
          <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
            ▸ Agrupe 2-50 dos seus assets num único item à venda
          </p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="bg-parchment border-4 border-ink shadow-pixel p-5 space-y-4">
          <Field label="Título *">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              className="w-full bg-parchment border-2 border-ink px-3 py-2 text-sm focus:outline-none focus:bg-arcane/10"
              placeholder="ex: Medieval Pack"
            />
          </Field>
          <Field label="Descrição (opcional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              className="w-full bg-parchment border-2 border-ink px-3 py-2 text-sm focus:outline-none focus:bg-arcane/10"
              placeholder="O que o comprador leva neste bundle..."
            />
          </Field>
          <Field label="Preço (R$) *">
            <input
              type="text"
              inputMode="decimal"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              required
              className="w-full bg-parchment border-2 border-ink px-3 py-2 text-sm focus:outline-none focus:bg-arcane/10"
              placeholder="99,90"
            />
            <p className="text-[10px] uppercase tracking-widest text-ink/60 mt-1">
              ▸ Valor cobrado pelo pack inteiro
            </p>
          </Field>
          <Field label="Capa do pack (opcional)">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setThumbFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs"
            />
            {thumbPreview && (
              <img
                src={thumbPreview}
                alt="Preview"
                className="mt-2 w-32 h-32 object-cover border-2 border-ink shadow-pixel-sm"
              />
            )}
            <p className="text-[10px] uppercase tracking-widest text-ink/60 mt-1">
              ▸ PNG/JPG/WEBP. Sem capa, mostramos a thumb do 1º asset.
            </p>
          </Field>
        </div>

        <AssetPicker
          assets={assets}
          error={loadError}
          selected={selected}
          onToggle={toggle}
          onRetry={load}
        />

        <div className="bg-twilight text-parchment border-4 border-ink shadow-pixel p-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-widest font-bold">
            {selected.size} / {MAX_ITEMS} selecionado(s)
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="
              bg-parchment text-ink border-4 border-ink shadow-pixel
              px-4 py-3 text-sm font-bold uppercase tracking-widest
              transition-all duration-75 ease-out
              hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
              disabled:opacity-50 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-pixel
            "
          >
            {saving ? '...' : '▶ Criar pack'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-widest font-bold text-ink/70">
        {label}
      </span>
      {children}
    </label>
  )
}

function AssetPicker({
  assets,
  error,
  selected,
  onToggle,
  onRetry,
}: {
  assets: Asset[] | null
  error: string | null
  selected: Set<number>
  onToggle: (id: number) => void
  onRetry: () => void
}) {
  if (error) {
    return (
      <div className="bg-ink text-parchment border-4 border-ink shadow-pixel p-6 text-center">
        <p className="text-sm font-bold uppercase tracking-widest mb-4">
          {error}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="bg-parchment text-ink border-4 border-ink shadow-pixel px-4 py-2 text-xs font-bold uppercase tracking-widest"
        >
          ▶ Tentar de novo
        </button>
      </div>
    )
  }
  if (assets === null) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-6 text-center animate-pulse">
        <p className="text-sm font-bold uppercase tracking-widest">
          ▌ Carregando seus assets...
        </p>
      </div>
    )
  }
  if (assets.length === 0) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-6 text-center">
        <p className="text-sm font-bold uppercase tracking-widest">
          Você ainda não publicou assets — crie pelo menos 2 antes de
          montar um pack.
        </p>
      </div>
    )
  }
  return (
    <fieldset className="bg-parchment border-4 border-ink shadow-pixel p-5">
      <legend className="text-xs uppercase tracking-widest font-bold text-ink/70 px-2">
        ▸ Selecione 2-{MAX_ITEMS} assets
      </legend>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-3">
        {assets.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onToggle(a.id)}
            aria-pressed={selected.has(a.id)}
            className={`
              text-left border-4 border-ink shadow-pixel-sm p-2 transition-all duration-75
              ${
                selected.has(a.id)
                  ? 'bg-arcane/30 ring-4 ring-arcane'
                  : 'bg-parchment hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none'
              }
            `}
          >
            <img
              src={fileUrl(a.thumbnail_path)}
              alt={a.title}
              className="w-full aspect-square object-cover border-2 border-ink"
              loading="lazy"
            />
            <p className="text-[10px] uppercase tracking-widest font-bold truncate mt-2">
              {a.title}
            </p>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function messageForCreate(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) {
      const body = err.body as { error?: string } | string
      if (typeof body === 'object' && body?.error) return body.error
      return 'Dados inválidos'
    }
    if (err.status === 413) return 'Arquivo muito grande'
    if (err.status === 415) return 'Tipo de arquivo não suportado'
  }
  return 'Falha ao criar pack'
}
