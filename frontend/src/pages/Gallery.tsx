import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Asset, type PublicUser, type TagCount } from '../api/client'
import {
  parseSort,
  sortAssets,
  SORT_OPTIONS,
  type SortKey,
} from '../lib/sort'
import { ASSET_GRID_CLASSES } from '../styles/pixel'
import AssetCard from '../components/AssetCard'
import AssetCardSkeleton from '../components/AssetCardSkeleton'
import Avatar from '../components/Avatar'

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
// Primeiros 4 cards assumimos acima da dobra (4 colunas). Recebem
// fetchpriority=high para acelerar o LCP.
const PRIORITY_COUNT = 4

export default function Gallery() {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  // tagCounts vem de GET /api/v1/tags (já ordenado por count desc).
  // Buscado em paralelo com /assets pra não serializar dois requests.
  // null = ainda carregando; [] = sem tags (catálogo vazio).
  const [tagCounts, setTagCounts] = useState<TagCount[] | null>(null)
  // trending: top assets por compras. Fetch independente do catálogo
  // principal pra que falha aqui não derrube a galeria — discovery,
  // não crítico. [] = nada comprado ainda; null = carregando.
  const [trending, setTrending] = useState<Asset[] | null>(null)
  // topCreators: usuários ordenados por contagem de assets (backend
  // já ordena). Pegamos só os primeiros 4 pra sessão da home.
  const [topCreators, setTopCreators] = useState<PublicUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // selectedTag vive em ?tag=X na URL — useSearchParams é a fonte da
  // verdade. Benefícios:
  //   - Linkável: /?tag=fantasia abre filtrado.
  //   - Browser back: volta pra "sem filtro" depois de selecionar.
  //   - Refresh preserva o filtro.
  //
  // searchParams.get retorna null quando não há ?tag/?q — caso "sem
  // filtro". Query é trimmed só na hora de filtrar; o input controlado
  // deixa o usuário ver os espaços que digitou.
  const [searchParams, setSearchParams] = useSearchParams()
  // selectedTags vem de TODOS os `?tag=` repetidos na URL.
  // `?tag=fantasia&tag=rpg` → ['fantasia', 'rpg']. Backward-compat:
  // links antigos `?tag=fantasia` continuam funcionando (array de 1).
  //
  // useMemo pra que o array tenha referência estável enquanto a URL
  // não muda — senão `selectedTags.includes(...)` dispararia
  // useEffect/useMemo de filhos a cada render do pai.
  const selectedTags = useMemo<string[]>(
    () => searchParams.getAll('tag'),
    [searchParams],
  )
  const query = searchParams.get('q') ?? ''
  // sort: chave do dropdown. Mantida como string + parser pra que valor
  // inválido na URL caia no default (recent) sem crashar a página.
  const sort = parseSort(searchParams.get('sort'))
  // Faixa de preço: ?min= e ?max= em REAIS (não centavos) pra que a
  // URL fique humanamente legível (/?min=10&max=50). Inválido/vazio →
  // null = sem limite. parsePrice cuida da validação.
  const priceMin = parsePrice(searchParams.get('min'))
  const priceMax = parsePrice(searchParams.get('max'))

  // setParam: helper genérico pra atualizar um único search param.
  // Push=true é o caso default (clique numa tag = ação intencional);
  // push=false é usado pela busca (cada keystroke não merece entrada
  // no histórico) e pelo auto-clear de filtro inválido.
  const setParam = useCallback(
    (key: string, value: string | null, push = true) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value === null || value === '') {
            next.delete(key)
          } else {
            next.set(key, value)
          }
          return next
        },
        { replace: !push },
      )
    },
    [setSearchParams],
  )

  // toggleTag: adiciona ou remove uma tag do array.
  //   - Tag já está → remove (URL sem mais aquele ?tag=X)
  //   - Tag não está → adiciona (URL ganha ?tag=X extra)
  //
  // searchParams.delete(key, value) precisa do valor pra deletar UM
  // dos múltiplos `?tag=`. Sem value, deleta TODOS os ?tag=. API
  // confirmada em URL Living Standard.
  const toggleTag = useCallback(
    (tag: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        const all = next.getAll('tag')
        if (all.includes(tag)) {
          // Re-set a lista sem o tag toggleado. Não dá pra usar
          // delete(key, value) com segurança em todos os browsers,
          // então recompõe.
          next.delete('tag')
          for (const t of all) {
            if (t !== tag) next.append('tag', t)
          }
        } else {
          next.append('tag', tag)
        }
        return next
      })
    },
    [setSearchParams],
  )

  const clearTags = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('tag')
      return next
    })
  }, [setSearchParams])

  const setQuery = useCallback(
    (q: string) => setParam('q', q.trim() || null, false),
    [setParam],
  )
  // setSort: passa null quando volta pro default ('recent') pra
  // manter a URL limpa (?sort=recent é redundante).
  const setSort = useCallback(
    (s: SortKey) => setParam('sort', s === 'recent' ? null : s),
    [setParam],
  )
  // setPriceMin/Max: push=false porque digitação produz muitos updates.
  // null limpa o param. Aceita string (do input) — conversão pra
  // número fica no parser; aqui só limpa whitespace e propaga.
  const setPriceMin = useCallback(
    (v: string) => setParam('min', v.trim() || null, false),
    [setParam],
  )
  const setPriceMax = useCallback(
    (v: string) => setParam('max', v.trim() || null, false),
    [setParam],
  )

  const clearAllFilters = useCallback(() => {
    setSearchParams(new URLSearchParams())
  }, [setSearchParams])

  const load = useCallback(() => {
    setError(null)
    setAssets(null)
    setTagCounts(null)
    setTrending(null)
    setTopCreators(null)
    let cancelled = false

    // Promise.all dispara os dois GETs principais em paralelo. Se
    // UM falhar (rede caiu, 5xx), entramos no error genérico — a
    // galeria sem tags é mais útil que sem nada, mas o front trata
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

    // Trending separado: falha silenciosa (setTrending([])) pra não
    // bloquear a galeria. Tem que ter limit=4 pra caber em uma linha
    // estética acima do catálogo.
    api
      .get<Asset[]>('/api/v1/trending?limit=4')
      .then((data) => {
        if (!cancelled) setTrending(data)
      })
      .catch(() => {
        if (!cancelled) setTrending([])
      })

    // Top criadores: top-4 por contagem de assets. Mesma estratégia
    // de falha silenciosa do trending — discovery, não crítico.
    api
      .get<PublicUser[]>('/api/v1/users?limit=4')
      .then((data) => {
        if (!cancelled) setTopCreators(data)
      })
      .catch(() => {
        if (!cancelled) setTopCreators([])
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

  // filteredAssets: combinação de facets.
  //   - busca: substring no título (AND com o resto)
  //   - faixa de preço: limites min/max (AND)
  //   - tags: OR entre as selecionadas, AND com os outros facets
  //
  // "OR dentro do facet, AND entre facets" é o padrão de marketplace:
  // selecionar mais tags amplia o resultado; selecionar tag + preço
  // restringe.
  const filteredAssets = useMemo<Asset[] | null>(() => {
    if (!assets) return null
    const needle = query.trim().toLowerCase()
    const minCents = priceMin !== null ? Math.round(priceMin * 100) : null
    const maxCents = priceMax !== null ? Math.round(priceMax * 100) : null
    const tagSet = new Set(selectedTags) // lookup O(1) por asset
    const filtered = assets.filter((a) => {
      // OR entre tags selecionadas: asset passa se TIVER PELO MENOS
      // uma das tags do filtro. Set vazio = sem filtro de tag.
      if (tagSet.size > 0 && !a.tags.some((t) => tagSet.has(t))) {
        return false
      }
      if (needle && !a.title.toLowerCase().includes(needle)) return false
      if (minCents !== null && a.price_cents < minCents) return false
      if (maxCents !== null && a.price_cents > maxCents) return false
      return true
    })
    return sortAssets(filtered, sort)
  }, [assets, selectedTags, query, sort, priceMin, priceMax])

  // Auto-clean: se alguma tag selecionada não existe mais no catálogo
  // (asset deletado, ou usuário digitou ?tag=naoexiste), remove só
  // ELA da URL — preserva as válidas. Replace pra não poluir histórico.
  useEffect(() => {
    if (tags.length === 0 || selectedTags.length === 0) return
    const validNames = new Set(tags.map((t) => t.tag))
    const invalid = selectedTags.filter((t) => !validNames.has(t))
    if (invalid.length === 0) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        const surviving = next.getAll('tag').filter((t) => validNames.has(t))
        next.delete('tag')
        for (const t of surviving) next.append('tag', t)
        return next
      },
      { replace: true },
    )
  }, [tags, selectedTags, setSearchParams])

  const hasPriceFilter = priceMin !== null || priceMax !== null
  const hasTagFilter = selectedTags.length > 0
  const hasFilter =
    hasTagFilter || query.trim() !== '' || hasPriceFilter

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <Hero
        totalCount={error ? null : assets?.length ?? null}
        filteredCount={filteredAssets?.length ?? null}
        selectedTags={selectedTags}
        query={query}
        priceMin={priceMin}
        priceMax={priceMax}
        loading={!error && assets === null}
        onQueryChange={setQuery}
      />
      {/* "Em alta": só renderiza quando NÃO há filtro ativo (em
          contexto de descoberta livre, não busca). Se a lista voltar
          vazia (catálogo sem vendas ainda), o componente esconde
          sozinho — sem placeholder ruidoso. */}
      {!hasFilter && trending && trending.length > 0 && (
        <TrendingSection assets={trending} />
      )}
      {/* "Top criadores": mesma lógica do trending — só sem filtro,
          esconde quando vazio. */}
      {!hasFilter && topCreators && topCreators.length > 0 && (
        <TopCreatorsSection users={topCreators} />
      )}
      {/* FilterBar: barra horizontal de botões-dropdown (Tags, Preço,
          Sort) no estilo de marketplaces modernos. Cada botão abre um
          painel logo abaixo com os controles reais. */}
      {assets && assets.length > 0 && (
        <FilterBar
          tags={tags}
          selectedTags={selectedTags}
          onToggleTag={toggleTag}
          onClearTags={clearTags}
          priceMin={searchParams.get('min') ?? ''}
          priceMax={searchParams.get('max') ?? ''}
          onPriceMinChange={setPriceMin}
          onPriceMaxChange={setPriceMax}
          sort={sort}
          onSortChange={setSort}
          hasAnyFilter={hasFilter}
          onClearAll={clearAllFilters}
        />
      )}
      <Content
        assets={filteredAssets}
        rawAssets={assets}
        error={error}
        onRetry={load}
        selectedTags={selectedTags}
        query={query}
        hasFilter={hasFilter}
        onClearFilters={clearAllFilters}
      />
    </div>
  )
}

// Hero: identidade da página + contador + input de busca.
//
// O input vive aqui (não numa toolbar separada) pra que o usuário
// ligue título da página, contador e busca como uma unidade visual.
// Em mobile, empilha em coluna; em desktop, fica lado a lado.
function Hero({
  totalCount,
  filteredCount,
  selectedTags,
  query,
  priceMin,
  priceMax,
  loading,
  onQueryChange,
}: {
  totalCount: number | null
  filteredCount: number | null
  selectedTags: string[]
  query: string
  priceMin: number | null
  priceMax: number | null
  loading: boolean
  onQueryChange: (q: string) => void
}) {
  // Debounce do input de busca:
  //   1. State local `localQuery` mantém o que está visualmente no
  //      campo — atualiza instantâneo a cada keystroke.
  //   2. setTimeout 200ms agendado a cada mudança; cleanup cancela
  //      o anterior. Só dispara onQueryChange (URL update) quando
  //      o usuário para de digitar por 200ms.
  //   3. useEffect de sync re-popula localQuery quando `query` muda
  //      por fonte externa (clear all, navegação direta).
  //
  // Benefício: filteredAssets não re-renderiza a galeria inteira a
  // cada tecla. Browser back/forward também ganha histórico mais
  // limpo (não tem 1 entrada por letra).
  const [localQuery, setLocalQuery] = useState(query)

  useEffect(() => {
    setLocalQuery(query)
  }, [query])

  useEffect(() => {
    if (localQuery === query) return
    const id = window.setTimeout(() => onQueryChange(localQuery), 200)
    return () => window.clearTimeout(id)
  }, [localQuery, query, onQueryChange])
  return (
    <header className="bg-parchment border-4 border-ink shadow-pixel">
      <p className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
        ▶ Catálogo
      </p>
      <div className="px-6 py-5 flex flex-wrap items-end gap-4 justify-between">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
            Mercado dos Aventureiros
          </h1>
          <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
            ▸{' '}
            {subtitle(
              totalCount,
              filteredCount,
              selectedTags,
              query,
              priceMin,
              priceMax,
              loading,
            )}
          </p>
        </div>
        {/* Input de busca isolado na Hero — busca é entrada livre,
            distinta dos filtros categóricos da FilterBar abaixo. */}
        <form
          role="search"
          onSubmit={(e) => e.preventDefault()}
          className="w-full sm:w-64"
        >
          <label className="block">
            <span className="sr-only">Buscar pelo título</span>
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/60 text-xs"
              >
                ▸
              </span>
              <input
                type="search"
                value={localQuery}
                onChange={(e) => setLocalQuery(e.target.value)}
                placeholder="Buscar pelo título..."
                className="
                  w-full bg-white text-ink border-4 border-ink
                  pl-8 pr-3 py-2 text-xs uppercase tracking-widest font-bold
                  focus:outline-none focus:shadow-pixel-sm
                "
              />
            </div>
          </label>
        </form>
      </div>
    </header>
  )
}

function subtitle(
  totalCount: number | null,
  filteredCount: number | null,
  selectedTags: string[],
  query: string,
  priceMin: number | null,
  priceMax: number | null,
  loading: boolean,
): string {
  if (loading) return 'Carregando catálogo...'
  if (totalCount === null) return 'Falha ao carregar'
  if (totalCount === 0) return 'Inventário vazio'

  // Qualquer filtro ativo → "X de Y" + breakdown. Tags com 3+
  // selecionadas viram "tags: 3 selecionadas" pra não poluir o
  // subtitle (linha única, espaço limitado).
  const hasQuery = query.trim() !== ''
  const hasPrice = priceMin !== null || priceMax !== null
  const hasTags = selectedTags.length > 0
  if (hasTags || hasQuery || hasPrice) {
    const n = filteredCount ?? 0
    const parts: string[] = []
    if (hasTags) {
      if (selectedTags.length <= 2) parts.push(`tags: ${selectedTags.join(', ')}`)
      else parts.push(`${selectedTags.length} tags`)
    }
    if (hasQuery) parts.push(`busca: "${query.trim()}"`)
    if (hasPrice) parts.push(`preço: ${formatPriceRange(priceMin, priceMax)}`)
    return `${n} de ${totalCount} · ${parts.join(' · ')}`
  }

  if (totalCount === 1) return '1 asset publicado'
  return `${totalCount} assets publicados`
}

// formatPriceRange: "R$10+", "≤R$50", "R$10-50". Compacto e claro.
function formatPriceRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `R$${min}-${max}`
  if (min !== null) return `R$${min}+`
  if (max !== null) return `≤R$${max}`
  return ''
}

// FilterBar: barra horizontal de botões-dropdown no estilo de
// marketplaces modernos (Style ∨, Price ∨, Sort by ∨ …).
//
// Cada botão exibe:
//   - Label da categoria ("Tags", "Preço", "Ordenar por")
//   - Badge entre parênteses com o estado atual: "(3)" tags selecionadas,
//     "(R$10-50)" range, "(A-Z)" sort label. Permite ler o filtro sem
//     abrir o painel.
//   - Chevron ▾ indicando "abrível".
//
// Estados visuais:
//   - default: bg-parchment text-ink
//   - active (filtro aplicado OU painel aberto): bg-arcane text-parchment
//
// "Limpar tudo" aparece à direita quando há QUALQUER filtro ativo,
// fora dos dropdowns — ação destrutiva merece visibilidade própria.
const FilterBar = memo(function FilterBar({
  tags,
  selectedTags,
  onToggleTag,
  onClearTags,
  priceMin,
  priceMax,
  onPriceMinChange,
  onPriceMaxChange,
  sort,
  onSortChange,
  hasAnyFilter,
  onClearAll,
}: {
  tags: TagCount[]
  selectedTags: string[]
  onToggleTag: (tag: string) => void
  onClearTags: () => void
  priceMin: string
  priceMax: string
  onPriceMinChange: (v: string) => void
  onPriceMaxChange: (v: string) => void
  sort: SortKey
  onSortChange: (s: SortKey) => void
  hasAnyFilter: boolean
  onClearAll: () => void
}) {
  // Contagem total de filtros ativos pra mostrar no label "▶ Filtros".
  // Tags conta por seleção; preço conta 1 se tem ALGUM dos lados;
  // sort conta 1 se não for o default.
  const priceCount = priceMin !== '' || priceMax !== '' ? 1 : 0
  const sortCount = sort !== 'recent' ? 1 : 0
  const activeCount = selectedTags.length + priceCount + sortCount

  return (
    <div
      role="region"
      aria-label="Filtros do catálogo"
      className="bg-parchment border-4 border-ink shadow-pixel px-3 py-2 flex flex-wrap items-center gap-2"
    >
      {/* LEFT — label "▶ Filtros" com badge de contagem. Apenas
          decorativo: comunica o que esta barra faz e quantos filtros
          estão ativos. */}
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-ink/70"
        aria-label={`${activeCount} filtros ativos`}
      >
        <span aria-hidden="true">▶ Filtros</span>
        {activeCount > 0 && (
          <span className="bg-arcane text-parchment border border-ink px-1 text-[9px]">
            {activeCount}
          </span>
        )}
      </span>

      {/* Spacer flex-grow empurra os componentes pra direita.
          Mais leve que pendurar ml-auto em cada dropdown ou propagar
          className via props. Quando a barra quebra em wrap (mobile),
          o spacer some naturalmente. */}
      <div className="ml-auto" aria-hidden="true" />

      {/* RIGHT — todos os componentes interativos */}
      <TagsDropdown
        tags={tags}
        selectedTags={selectedTags}
        onToggleTag={onToggleTag}
        onClearTags={onClearTags}
      />
      <PriceDropdown
        min={priceMin}
        max={priceMax}
        onMinChange={onPriceMinChange}
        onMaxChange={onPriceMaxChange}
      />
      <SortDropdown sort={sort} onChange={onSortChange} />
      {hasAnyFilter && (
        <button
          type="button"
          onClick={onClearAll}
          className="
            text-[10px] uppercase tracking-widest font-bold
            border-2 border-ink shadow-pixel-sm
            bg-ink text-parchment px-2 py-1
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ✗ Limpar tudo
        </button>
      )}
    </div>
  )
})

// FilterDropdown: bloco reusable botão + popover.
//
// Responsabilidades:
//   - Renderiza o botão pixel-art com label + badge + chevron
//   - Abre/fecha popover ao clicar
//   - Click-outside fecha (capturando mousedown)
//   - Esc fecha
//   - Popover é absolutamente posicionado abaixo do botão
//   - Estado active quando: painel aberto OU `isActive=true` (filtro aplicado)
//
// Cada filtro específico (Tags/Price/Sort) chama este componente
// e passa seu conteúdo como children. Mantemos o `useState` aberto
// dentro do FilterDropdown — sem hoisting que complicaria os pais.
function FilterDropdown({
  label,
  badge,
  isActive,
  align = 'left',
  children,
}: {
  label: string
  badge?: string | null
  isActive: boolean
  // align: 'left' alinha o painel ao botão (default); 'right'
  // alinha pela direita (útil pra dropdowns na extremidade direita
  // que senão estourariam pra fora da viewport).
  align?: 'left' | 'right'
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Click-outside + Esc fecham. Listener só quando aberto pra não
  // pendurar event handlers em todos os dropdowns simultaneamente.
  useEffect(() => {
    if (!open) return
    function onMouse(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Botão "active" tanto quando aberto quanto quando o filtro está
  // aplicado — dá feedback visual consistente.
  const buttonActive = open || isActive
  const bg = buttonActive
    ? 'bg-arcane text-parchment'
    : 'bg-parchment text-ink'

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`
          ${bg} border-2 border-ink shadow-pixel-sm
          px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest
          inline-flex items-center gap-2
          transition-all duration-75 ease-out
          hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none
        `}
      >
        <span>{label}</span>
        {badge && <span className="opacity-80">({badge})</span>}
        <span aria-hidden="true" className="text-[8px]">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          className={`
            absolute top-full mt-1 z-20
            bg-parchment border-4 border-ink shadow-pixel
            p-3 min-w-[240px]
            ${align === 'right' ? 'right-0' : 'left-0'}
          `}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

// TagsDropdown: chips multi-select dentro de um popover scrollavel.
// Badge mostra contagem de tags selecionadas.
function TagsDropdown({
  tags,
  selectedTags,
  onToggleTag,
  onClearTags,
}: {
  tags: TagCount[]
  selectedTags: string[]
  onToggleTag: (tag: string) => void
  onClearTags: () => void
}) {
  const selectedSet = useMemo(() => new Set(selectedTags), [selectedTags])
  const badge = selectedTags.length > 0 ? String(selectedTags.length) : null

  return (
    <FilterDropdown label="Tags" badge={badge} isActive={selectedTags.length > 0}>
      {() => (
        <div className="space-y-2 max-w-xs">
          {/* max-h limita altura pra catálogos com muitas tags. */}
          <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto">
            {tags.map(({ tag, count }) => (
              <Chip
                key={tag}
                active={selectedSet.has(tag)}
                onClick={() => onToggleTag(tag)}
                label={`${tag} (${count})`}
              />
            ))}
          </div>
          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={onClearTags}
              className="text-[10px] uppercase tracking-widest font-bold underline underline-offset-4 decoration-2 hover:text-arcane"
            >
              ✗ Limpar tags
            </button>
          )}
        </div>
      )}
    </FilterDropdown>
  )
}

// PriceDropdown: 2 inputs Min/Max dentro do popover. Badge resume o range.
function PriceDropdown({
  min,
  max,
  onMinChange,
  onMaxChange,
}: {
  min: string
  max: string
  onMinChange: (v: string) => void
  onMaxChange: (v: string) => void
}) {
  const hasPrice = min !== '' || max !== ''
  const badge = hasPrice ? formatPriceBadge(min, max) : null

  return (
    <FilterDropdown label="Preço" badge={badge} isActive={hasPrice}>
      {() => (
        <div className="space-y-3 min-w-[220px]">
          <div className="flex items-center gap-2">
            <PriceInput
              label="Min"
              value={min}
              onChange={onMinChange}
              placeholder="0"
            />
            <span className="text-ink/40">—</span>
            <PriceInput
              label="Max"
              value={max}
              onChange={onMaxChange}
              placeholder="∞"
            />
          </div>
          {hasPrice && (
            <button
              type="button"
              onClick={() => {
                onMinChange('')
                onMaxChange('')
              }}
              className="text-[10px] uppercase tracking-widest font-bold underline underline-offset-4 decoration-2 hover:text-arcane"
            >
              ✗ Limpar preço
            </button>
          )}
        </div>
      )}
    </FilterDropdown>
  )
}

// formatPriceBadge: "10-50" / "10+" / "≤50". Compacto pro botão.
function formatPriceBadge(min: string, max: string): string {
  if (min && max) return `R$${min}-${max}`
  if (min) return `R$${min}+`
  return `≤R$${max}`
}

// SortDropdown: lista de opções selectionable. Cada opção é um
// botão que fecha o popover ao escolher. Badge mostra a opção
// ativa (ex: "Mais recentes").
function SortDropdown({
  sort,
  onChange,
}: {
  sort: SortKey
  onChange: (s: SortKey) => void
}) {
  const current = SORT_OPTIONS.find((o) => o.key === sort)
  // Quando sort = 'recent' (default), não mostramos badge — é o
  // estado "não-modificado". Outros viram badge pra reforçar a
  // escolha do usuário.
  const badge = sort !== 'recent' ? current?.label ?? null : null

  return (
    <FilterDropdown
      label="Ordenar por"
      badge={badge}
      isActive={sort !== 'recent'}
      align="right"
    >
      {(close) => (
        <ul role="menu" className="space-y-1 min-w-[180px]">
          {SORT_OPTIONS.map(({ key, label }) => {
            const isCurrent = key === sort
            return (
              <li key={key} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isCurrent}
                  onClick={() => {
                    onChange(key)
                    close()
                  }}
                  className={`
                    w-full text-left px-2 py-1.5
                    text-[10px] font-bold uppercase tracking-widest
                    transition-colors duration-75
                    ${
                      isCurrent
                        ? 'bg-arcane text-parchment'
                        : 'bg-parchment text-ink hover:bg-ink/10'
                    }
                  `}
                >
                  {isCurrent ? '▶ ' : ''}
                  {label}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </FilterDropdown>
  )
}

// PriceInput: label + input numérico curto. Reusado dentro do
// PriceDropdown pros campos Min e Max.
function PriceInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-ink/60">
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="
          w-20 bg-white text-ink border-2 border-ink
          px-2 py-1 text-xs font-mono
          focus:outline-none focus:shadow-pixel-sm
        "
      />
    </label>
  )
}

// Chip: botão pixel compacto pro filtro. Active = cores invertidas
// (arcane); inactive = parchment. Os dois respondem ao hover-press
// padrão pra dar feedback tátil. aria-pressed comunica o estado pra
// leitor de tela.
//
// API mudou: antes recebia `children: ReactNode` (não-estável,
// quebrava memo); agora recebe `label: string`. Sem memo aqui
// porque `onClick` continua sendo arrow inline no caller (mas o
// custo de re-render de N botões pequenos é baixo).
function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
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
      {label}
    </button>
  )
}

// Content: renderiza o conteúdo específico para cada estado.
// Recebe BOTH filtered e raw porque precisa distinguir "vazio porque
// catálogo zerado" de "vazio porque filtro (tag/busca) não casou".
function Content({
  assets,
  rawAssets,
  error,
  onRetry,
  selectedTags,
  query,
  hasFilter,
  onClearFilters,
}: {
  assets: Asset[] | null
  rawAssets: Asset[] | null
  error: string | null
  onRetry: () => void
  selectedTags: string[]
  query: string
  hasFilter: boolean
  onClearFilters: () => void
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

  // Vazio porque o filtro (tag e/ou busca) não casou. Mensagem
  // adaptada pra refletir o que está ativo — UX mais clara que um
  // "Sem resultados" genérico.
  if (assets.length === 0 && hasFilter) {
    const hasQuery = query.trim() !== ''
    // Mensagem do empty state varia conforme o filtro ativo. Não
    // tentamos enumerar todas as combinações (tag+busca+preço); usamos
    // uma mensagem genérica quando o usuário tem múltiplos filtros.
    const hasTags = selectedTags.length > 0
    let message: string
    if (hasTags && hasQuery) {
      const label = selectedTags.length === 1 ? selectedTags[0] : `${selectedTags.length} tags`
      message = `Nada com "${query.trim()}" em ${label}`
    } else if (hasTags) {
      if (selectedTags.length === 1) {
        message = `Nenhum asset com a tag "${selectedTags[0]}"`
      } else {
        message = `Nenhum asset com as ${selectedTags.length} tags selecionadas`
      }
    } else if (hasQuery) {
      message = `Nada combinou com "${query.trim()}"`
    } else {
      message = 'Nenhum asset combina com os filtros'
    }
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center">
        <p className="text-5xl mb-4" aria-hidden="true">
          ✦
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          {message}
        </p>
        <button
          onClick={onClearFilters}
          className="
            mt-4 inline-block bg-arcane text-parchment border-4 border-ink shadow-pixel
            px-4 py-2 text-xs font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
          "
        >
          ▶ Limpar filtros
        </button>
      </div>
    )
  }

  return (
    <div className={ASSET_GRID_CLASSES}>
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

// TrendingSection: sessão fixa "Em alta" no topo da galeria.
// Aparece só quando NÃO há filtro ativo — quando o usuário está
// buscando algo específico, ver "mais vendidos" é distração.
//
// Cards renderizados com `priority={true}` porque a sessão fica
// above-the-fold antes do catálogo principal — vale fetchpriority
// alto nas thumbnails pra LCP.
//
// memo: `assets` é set uma vez no load e nunca mais; digitar na
// busca não re-renderiza este componente.
const TrendingSection = memo(function TrendingSection({
  assets,
}: {
  assets: Asset[]
}) {
  return (
    <section className="bg-parchment border-4 border-ink shadow-pixel">
      <h2 className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
        ▶ Em alta
      </h2>
      <div className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {assets.map((a) => (
            <AssetCard key={a.id} asset={a} priority />
          ))}
        </div>
      </div>
    </section>
  )
})

// TopCreatorsSection: sessão "Top criadores" no topo da galeria.
// Mesma motivação visual do TrendingSection mas com cards menores
// (4 colunas independente do breakpoint maior, pra caber mais).
//
// "Ver todos" no header leva pra /criadores (diretório completo).
const TopCreatorsSection = memo(function TopCreatorsSection({
  users,
}: {
  users: PublicUser[]
}) {
  return (
    <section className="bg-parchment border-4 border-ink shadow-pixel">
      <div className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3 flex items-center justify-between">
        <span>▶ Top criadores</span>
        <Link
          to="/criadores"
          className="text-[10px] underline underline-offset-4 decoration-2 hover:opacity-80"
        >
          Ver todos
        </Link>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {users.map((u) => (
            <TopCreatorCard key={u.id} user={u} />
          ))}
        </div>
      </div>
    </section>
  )
})

// TopCreatorCard: mini-card horizontal compacto pra encaixar no grid
// 2/4 colunas. Não duplica o CreatorCard de /criadores porque aqui
// queremos algo mais denso (4 numa linha) — esse é wide e enxuto.
const TopCreatorCard = memo(function TopCreatorCard({
  user,
}: {
  user: PublicUser
}) {
  const count = user.asset_count ?? 0
  return (
    <Link
      to={`/u/${user.username}`}
      className="
        bg-parchment border-2 border-ink shadow-pixel-sm
        transition-all duration-75 ease-out
        hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none
        p-2 flex items-center gap-2 min-w-0
      "
    >
      <Avatar
        avatarPath={user.avatar_path}
        name={user.display_name}
        size="sm"
      />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-xs uppercase tracking-wider truncate">
          {user.display_name}
        </p>
        <p className="text-[9px] uppercase tracking-widest text-ink/60 mt-0.5">
          {count === 0
            ? 'nenhum asset'
            : count === 1
              ? '1 asset'
              : `${count} assets`}
        </p>
      </div>
    </Link>
  )
})

// parsePrice: string da URL → number em reais ou null. Aceita
// inteiro ou decimal (com . ou ,). Negativos e NaN viram null pra
// que ?min=abc não crashe.
function parsePrice(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const v = Number(raw.replace(',', '.'))
  if (!Number.isFinite(v) || v < 0) return null
  return v
}

// Sort helpers (SortKey, SORT_OPTIONS, parseSort, sortAssets) vivem
// em src/lib/sort.ts — testáveis em isolamento sem React.
