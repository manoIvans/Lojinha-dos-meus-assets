import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type Asset, type TagCount } from '../api/client'
import AssetCard from '../components/AssetCard'
import AssetCardSkeleton from '../components/AssetCardSkeleton'

// Galeria pública.
//
// Layout reestruturado para que o HERO esteja SEMPRE presente — antes
// cada estado (loading/erro/vazio) retornava sua própria árvore, o
// que fazia o header sumir e a página "saltar" visualmente quando os
// dados chegavam. Agora a estrutura é:
//
//   <div>
//     <Hero count={...} />        ← sempre renderizado
//     <TagFilter ... />            ← só quando há assets
//     <Content ... />              ← skeletons / erro / vazio / grid
//   </div>
//
// Estado modelado como discriminação implícita (assets null vs []):
//
//   assets === null + error === null  → loading (skeletons)
//   assets === null + error           → erro com retry
//   assets === []   + error === null  → vazio
//   assets:Asset[]  + error === null  → grid de cards (filtrado se aplicável)

const SKELETON_COUNT = 8
const GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6'
// Primeiros 4 cards assumimos acima da dobra (4 colunas). Recebem
// fetchpriority=high para acelerar o LCP.
const PRIORITY_COUNT = 4

export default function Gallery() {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  // tagCounts vem de GET /api/v1/tags (já ordenado por count desc).
  // Buscado em paralelo com /assets pra não serializar dois requests.
  // null = ainda carregando; [] = sem tags (catálogo vazio).
  const [tagCounts, setTagCounts] = useState<TagCount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // selectedTag vive em ?tag=X na URL — useSearchParams é a fonte da
  // verdade. Benefícios:
  //   - Linkável: /?tag=fantasia abre filtrado.
  //   - Browser back: volta pra "sem filtro" depois de selecionar.
  //   - Refresh preserva o filtro.
  //
  // searchParams.get retorna null quando não há ?tag — caso "Todos".
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTag = searchParams.get('tag')

  // setSelectedTag empacota a manipulação de search params. Recebe
  // null pra limpar (chip "Todos") ou string pra filtrar. push=true
  // é o default (clique do usuário → nova entrada no histórico);
  // push=false é usado pelo auto-clear (não polui o histórico com
  // navegações automáticas).
  const setSelectedTag = useCallback(
    (tag: string | null, push = true) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (tag === null) {
            next.delete('tag')
          } else {
            next.set('tag', tag)
          }
          return next
        },
        { replace: !push },
      )
    },
    [setSearchParams],
  )

  const load = useCallback(() => {
    setError(null)
    setAssets(null)
    setTagCounts(null)
    let cancelled = false

    // Promise.all dispara os dois GETs em paralelo. Se UM falhar
    // (rede caiu, 5xx), entramos no error genérico — a galeria sem
    // tags é mais útil que a galeria sem nada, mas o front trata
    // "falha de carga total" como um único estado pra simplificar.
    Promise.all([
      api.get<Asset[]>('/api/v1/assets'),
      api.get<TagCount[]>('/api/v1/tags'),
    ])
      .then(([assetsData, tagsData]) => {
        if (cancelled) return
        setAssets(assetsData)
        setTagCounts(tagsData)
      })
      .catch(() => {
        if (!cancelled) setError('Falha ao carregar a galeria.')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = load()
    return cancel
  }, [load])

  // tags computed: ordem do backend (count desc, tag asc no empate).
  // Antes derivávamos do `assets` carregado; agora o backend é a fonte
  // de verdade — o front não precisa contar nada.
  const tags = useMemo<TagCount[]>(() => tagCounts ?? [], [tagCounts])

  // filteredAssets: aplica o filtro selectedTag SE houver. Sem filtro,
  // mostra tudo. Derivado também (useMemo) pra evitar re-filtrar
  // quando outros estados mudam (ex: error).
  const filteredAssets = useMemo<Asset[] | null>(() => {
    if (!assets) return null
    if (!selectedTag) return assets
    return assets.filter((a) => a.tags.includes(selectedTag))
  }, [assets, selectedTag])

  // Se o usuário tinha um filtro ativo e a tag não existe mais (asset
  // deletado, refresh trouxe lista sem ela) OU o usuário digitou
  // ?tag=naoexiste manualmente — limpa o filtro pra evitar empty
  // state confuso. push=false para não poluir o histórico com a
  // correção automática.
  useEffect(() => {
    if (
      selectedTag &&
      tags.length > 0 &&
      !tags.some((t) => t.tag === selectedTag)
    ) {
      setSelectedTag(null, false)
    }
  }, [tags, selectedTag, setSelectedTag])

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <Hero
        totalCount={error ? null : assets?.length ?? null}
        filteredCount={filteredAssets?.length ?? null}
        selectedTag={selectedTag}
        loading={!error && assets === null}
      />
      {/* TagFilter só aparece quando temos assets e há tags pra escolher.
          Esconder em loading/erro/vazio evita botões fantasmas. */}
      {assets && tags.length > 0 && (
        <TagFilter
          tags={tags}
          selected={selectedTag}
          onSelect={setSelectedTag}
        />
      )}
      <Content
        assets={filteredAssets}
        rawAssets={assets}
        error={error}
        onRetry={load}
        selectedTag={selectedTag}
        onClearFilter={() => setSelectedTag(null)}
      />
    </div>
  )
}

// Hero: identidade da página + contador dinâmico. Permanece em todos
// os estados — só o subtítulo muda. Quando há filtro ativo, mostra
// "X de Y · tag: T" em vez do contador normal, dando contexto duplo
// (resultado + filtro).
function Hero({
  totalCount,
  filteredCount,
  selectedTag,
  loading,
}: {
  totalCount: number | null
  filteredCount: number | null
  selectedTag: string | null
  loading: boolean
}) {
  return (
    <header className="bg-parchment border-4 border-ink shadow-pixel">
      <p className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
        ▶ Catálogo
      </p>
      <div className="px-6 py-5">
        <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
          Mercado dos Aventureiros
        </h1>
        <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
          ▸ {subtitle(totalCount, filteredCount, selectedTag, loading)}
        </p>
      </div>
    </header>
  )
}

function subtitle(
  totalCount: number | null,
  filteredCount: number | null,
  selectedTag: string | null,
  loading: boolean,
): string {
  if (loading) return 'Carregando catálogo...'
  if (totalCount === null) return 'Falha ao carregar'
  if (totalCount === 0) return 'Inventário vazio'

  if (selectedTag) {
    const n = filteredCount ?? 0
    return `${n} de ${totalCount} · tag: ${selectedTag}`
  }

  if (totalCount === 1) return '1 asset publicado'
  return `${totalCount} assets publicados`
}

// TagFilter: linha de chips horizontais com flex-wrap. Cada chip é
// um botão pixel-art; o ativo recebe cores invertidas (bg-arcane).
// Chip "Todos" no início serve como reset do filtro.
//
// A contagem aparece com cor reduzida (text-X/60) e fonte um pouco
// menor — afirma a info sem competir com a tag em si.
function TagFilter({
  tags,
  selected,
  onSelect,
}: {
  tags: TagCount[]
  selected: string | null
  onSelect: (tag: string | null) => void
}) {
  // Total = soma de todas as ocorrências de tag no catálogo, NÃO o
  // número de assets distintos (um asset com 3 tags conta 3x). Pra
  // UX do filtro "Todos", o valor é o melhor proxy disponível sem
  // outra request.
  const total = tags.reduce((acc, t) => acc + t.count, 0)
  return (
    <div
      role="toolbar"
      aria-label="Filtrar por tag"
      className="bg-parchment border-4 border-ink shadow-pixel p-3 flex flex-wrap gap-2"
    >
      <Chip active={selected === null} onClick={() => onSelect(null)}>
        Todos <span className="opacity-60">({total})</span>
      </Chip>
      {tags.map(({ tag, count }) => (
        <Chip
          key={tag}
          active={selected === tag}
          onClick={() => onSelect(tag)}
        >
          {tag} <span className="opacity-60">({count})</span>
        </Chip>
      ))}
    </div>
  )
}

// Chip: botão pixel compacto pro filtro. Active = cores invertidas
// (arcane); inactive = parchment. Os dois respondem ao hover-press
// padrão pra dar feedback tátil. aria-pressed comunica o estado pra
// leitor de tela.
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  const base =
    'px-3 py-1 text-[10px] font-bold uppercase tracking-widest ' +
    'border-2 border-ink shadow-pixel-sm ' +
    'transition-all duration-75 ease-out ' +
    'hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none ' +
    'active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
  const color = active
    ? 'bg-arcane text-parchment'
    : 'bg-parchment text-ink'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} ${color}`}
    >
      {children}
    </button>
  )
}

// Content: renderiza o conteúdo específico para cada estado.
// Recebe BOTH filtered e raw porque precisa distinguir "vazio porque
// catálogo zerado" de "vazio porque filtro não casou".
function Content({
  assets,
  rawAssets,
  error,
  onRetry,
  selectedTag,
  onClearFilter,
}: {
  assets: Asset[] | null
  rawAssets: Asset[] | null
  error: string | null
  onRetry: () => void
  selectedTag: string | null
  onClearFilter: () => void
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
      <div className={GRID_CLASSES} aria-busy="true" aria-live="polite">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <AssetCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  // Vazio porque o catálogo TODO está vazio (rawAssets vazio).
  if (rawAssets !== null && rawAssets.length === 0) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center">
        <p className="text-5xl mb-4" aria-hidden="true">
          ✦
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Inventário vazio
        </p>
        <p className="text-xs text-ink/70 tracking-wider">
          Nenhum asset publicado ainda — seja o primeiro!
        </p>
      </div>
    )
  }

  // Vazio porque o filtro não casou. Diferente do caso acima — aqui
  // há assets no catálogo, só não com a tag escolhida. Oferece reset.
  if (assets.length === 0 && selectedTag) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center">
        <p className="text-5xl mb-4" aria-hidden="true">
          ✦
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Nenhum asset com a tag “{selectedTag}”
        </p>
        <button
          onClick={onClearFilter}
          className="
            mt-4 inline-block bg-arcane text-parchment border-4 border-ink shadow-pixel
            px-4 py-2 text-xs font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ▶ Mostrar todos
        </button>
      </div>
    )
  }

  return (
    <div className={GRID_CLASSES}>
      {assets.map((asset, i) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          priority={i < PRIORITY_COUNT}
        />
      ))}
    </div>
  )
}
