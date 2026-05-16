import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api, fileUrl, type Asset } from '../api/client'
import ModelViewer from '../components/ModelViewer'

// AssetDetail (/asset/:id): página de detalhe do asset, dividida em
// duas regiões via grid:
//   - lg:col-span-2 → Visualizador 3D (2/3 da largura no desktop)
//   - lg              → Painel de metadados (1/3 da largura)
// Em mobile (sem prefixo lg:), as regiões empilham vertical com o
// viewer em cima.
//
// Estado é modelado em 3 variáveis distintas porque os casos não são
// mutuamente exclusivos durante o ciclo de vida da request:
//   - loading: enquanto o fetch está pendente
//   - notFound: 404 do backend (asset que NUNCA existiu ou foi deletado)
//   - error: qualquer outro fail (rede, 5xx, etc.)
//
// notFound vs error são separados de propósito: o copy é diferente
// ("não existe" vs "deu pau ao buscar"), e a UX talvez evolua pra
// oferecer "tentar de novo" só no segundo caso.
export default function AssetDetail() {
  const { id } = useParams<{ id: string }>()
  const [asset, setAsset] = useState<Asset | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Sem id válido na URL, redireciona pra erro 404-ish em vez de
    // chamar a API com path malformado.
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
  if (error || !asset) return <ErrorState message={error ?? 'Erro desconhecido'} />

  return <Detail asset={asset} />
}

// Detail é o componente puro que renderiza o conteúdo quando o asset
// foi carregado com sucesso. Separado da página principal porque
// (1) evita um if/return gigante no componente top-level, (2) deixa
// fácil de testar isoladamente passando um asset mock.
function Detail({ asset }: { asset: Asset }) {
  return (
    <div className="max-w-7xl mx-auto p-6">
      <Link
        to="/"
        className="inline-block mb-4 text-xs font-bold uppercase tracking-widest text-parchment hover:underline underline-offset-4 decoration-2"
      >
        ◀ Voltar à galeria
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Visualizador 3D — 2/3 da largura no desktop */}
        <section className="lg:col-span-2">
          <div className="bg-parchment border-4 border-ink shadow-pixel">
            <h2 className="bg-arcane text-parchment font-pixel text-sm uppercase border-b-4 border-ink px-4 py-3">
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

        {/* Painel de metadados — 1/3 da largura no desktop */}
        <aside>
          <div className="bg-parchment border-4 border-ink shadow-pixel">
            <h2 className="bg-arcane text-parchment font-pixel text-sm uppercase border-b-4 border-ink px-4 py-3">
              ▶ Detalhes
            </h2>

            <div className="p-4 space-y-4">
              {/* Título + autor */}
              <div>
                <h1 className="text-lg font-bold uppercase tracking-wider break-words">
                  {asset.title}
                </h1>
                <p className="text-xs uppercase tracking-wider text-ink/60 mt-1">
                  por{' '}
                  <span className="font-bold">
                    {asset.author_name ?? 'anônimo'}
                  </span>
                </p>
              </div>

              {/* Preço — proeminente */}
              <p className="text-2xl font-bold">
                ✦ {formatPrice(asset.price_cents)}
              </p>

              {/* Descrição. whitespace-pre-wrap preserva quebras de
                  linha que o autor digitou no formulário. */}
              <div className="border-t-4 border-ink pt-4">
                <h3 className="text-xs font-bold uppercase tracking-widest mb-2">
                  Descrição
                </h3>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {asset.description.trim() || (
                    <span className="text-ink/50">— sem descrição —</span>
                  )}
                </p>
              </div>

              {/* Tags. Hoje o backend só tem `category` (uma string).
                  Renderizamos como uma "tag" única — quando virar
                  multi-tag (coluna text[] ou tabela pivot), basta
                  trocar o array fonte. */}
              <div className="border-t-4 border-ink pt-4">
                <h3 className="text-xs font-bold uppercase tracking-widest mb-2">
                  Tags
                </h3>
                <div className="flex flex-wrap gap-2">
                  <span className="inline-block bg-arcane text-parchment text-[10px] px-2 py-1 uppercase tracking-widest font-bold">
                    {asset.category}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </aside>
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

// formatPrice em escopo de módulo: construtor de Intl.NumberFormat é
// caro relativo ao .format(). Duplicado em AssetCard.tsx — quando
// aparecer um terceiro consumer, extrair pra src/lib/format.ts.
const priceFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function formatPrice(cents: number): string {
  return priceFormatter.format(cents / 100)
}
