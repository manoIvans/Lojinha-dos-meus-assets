import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Asset, type PublicUser, type TagCount } from '../api/client'
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
  const selectedTag = searchParams.get('tag')
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

  // Wrappers tipados pros consumers. setSelectedTag mantém a API
  // antiga (string | null) que TagFilter espera. setQuery usa
  // push=false porque digitação produz muitos updates.
  const setSelectedTag = useCallback(
    (tag: string | null, push = true) => setParam('tag', tag, push),
    [setParam],
  )
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

  // filteredAssets: AND entre selectedTag, query e faixa de preço,
  // depois sort. Match case-insensitive na busca pra que "ESPADA"
  // case com "espada do herói". O sort cria uma cópia antes de
  // ordenar — não mutar o array original.
  //
  // Preço: comparamos em centavos pra evitar float math. priceMin/Max
  // vêm em reais (number), multiplico por 100 inline. null = sem
  // limite naquele lado.
  const filteredAssets = useMemo<Asset[] | null>(() => {
    if (!assets) return null
    const needle = query.trim().toLowerCase()
    const minCents = priceMin !== null ? Math.round(priceMin * 100) : null
    const maxCents = priceMax !== null ? Math.round(priceMax * 100) : null
    const filtered = assets.filter((a) => {
      if (selectedTag && !a.tags.includes(selectedTag)) return false
      if (needle && !a.title.toLowerCase().includes(needle)) return false
      if (minCents !== null && a.price_cents < minCents) return false
      if (maxCents !== null && a.price_cents > maxCents) return false
      return true
    })
    return sortAssets(filtered, sort)
  }, [assets, selectedTag, query, sort, priceMin, priceMax])

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

  const hasPriceFilter = priceMin !== null || priceMax !== null
  const hasFilter =
    selectedTag !== null || query.trim() !== '' || hasPriceFilter

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <Hero
        totalCount={error ? null : assets?.length ?? null}
        filteredCount={filteredAssets?.length ?? null}
        selectedTag={selectedTag}
        query={query}
        sort={sort}
        priceMin={priceMin}
        priceMax={priceMax}
        loading={!error && assets === null}
        onQueryChange={setQuery}
        onSortChange={setSort}
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
      {/* Filtros auxiliares (preço) aparecem quando há assets. Linha
          própria porque a Hero já está densa e o TagFilter cresce
          variavelmente. */}
      {assets && assets.length > 0 && (
        <PriceFilter
          min={searchParams.get('min') ?? ''}
          max={searchParams.get('max') ?? ''}
          onMinChange={setPriceMin}
          onMaxChange={setPriceMax}
        />
      )}
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
  selectedTag,
  query,
  sort,
  priceMin,
  priceMax,
  loading,
  onQueryChange,
  onSortChange,
}: {
  totalCount: number | null
  filteredCount: number | null
  selectedTag: string | null
  query: string
  sort: SortKey
  priceMin: number | null
  priceMax: number | null
  loading: boolean
  onQueryChange: (q: string) => void
  onSortChange: (s: SortKey) => void
}) {
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
              selectedTag,
              query,
              priceMin,
              priceMax,
              loading,
            )}
          </p>
        </div>
        {/* Bloco de controles: busca + sort. flex-col em telas menores
            empilha; em desktop fica lado a lado. */}
        <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2">
          {/* Input de busca. role="search" + label sr-only para
              leitores de tela; o placeholder + ícone ▸ comunicam
              a intenção visualmente. */}
          <form
            role="search"
            onSubmit={(e) => e.preventDefault()}
            className="w-full sm:w-56"
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
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
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
          <SortDropdown sort={sort} onChange={onSortChange} />
        </div>
      </div>
    </header>
  )
}

// SortDropdown: select nativo estilizado pixel-art. Native select é
// melhor que um menu custom porque:
//   - acessível por teclado de graça
//   - mobile dá o picker nativo
//   - menos código pra manter
//
// O appearance-none + ícone manual recria o visual sem perder a
// semântica do <select>.
function SortDropdown({
  sort,
  onChange,
}: {
  sort: SortKey
  onChange: (s: SortKey) => void
}) {
  return (
    <label className="block w-full sm:w-auto">
      <span className="sr-only">Ordenar por</span>
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/60 text-xs"
        >
          ↕
        </span>
        <select
          value={sort}
          onChange={(e) => onChange(e.target.value as SortKey)}
          className="
            w-full bg-white text-ink border-4 border-ink
            pl-8 pr-8 py-2 text-xs uppercase tracking-widest font-bold
            appearance-none
            focus:outline-none focus:shadow-pixel-sm
            cursor-pointer
          "
        >
          {SORT_OPTIONS.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/60 text-xs pointer-events-none"
        >
          ▾
        </span>
      </div>
    </label>
  )
}

function subtitle(
  totalCount: number | null,
  filteredCount: number | null,
  selectedTag: string | null,
  query: string,
  priceMin: number | null,
  priceMax: number | null,
  loading: boolean,
): string {
  if (loading) return 'Carregando catálogo...'
  if (totalCount === null) return 'Falha ao carregar'
  if (totalCount === 0) return 'Inventário vazio'

  // Qualquer filtro ativo (tag, busca, faixa de preço) → "X de Y" + breakdown.
  const hasQuery = query.trim() !== ''
  const hasPrice = priceMin !== null || priceMax !== null
  if (selectedTag || hasQuery || hasPrice) {
    const n = filteredCount ?? 0
    const parts: string[] = []
    if (selectedTag) parts.push(`tag: ${selectedTag}`)
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
// catálogo zerado" de "vazio porque filtro (tag/busca) não casou".
function Content({
  assets,
  rawAssets,
  error,
  onRetry,
  selectedTag,
  query,
  hasFilter,
  onClearFilters,
}: {
  assets: Asset[] | null
  rawAssets: Asset[] | null
  error: string | null
  onRetry: () => void
  selectedTag: string | null
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

  // Vazio porque o filtro (tag e/ou busca) não casou. Mensagem
  // adaptada pra refletir o que está ativo — UX mais clara que um
  // "Sem resultados" genérico.
  if (assets.length === 0 && hasFilter) {
    const hasQuery = query.trim() !== ''
    let message: string
    if (selectedTag && hasQuery) {
      message = `Nada com "${query.trim()}" na tag "${selectedTag}"`
    } else if (selectedTag) {
      message = `Nenhum asset com a tag "${selectedTag}"`
    } else {
      message = `Nada combinou com "${query.trim()}"`
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

// TrendingSection: sessão fixa "Em alta" no topo da galeria.
// Aparece só quando NÃO há filtro ativo — quando o usuário está
// buscando algo específico, ver "mais vendidos" é distração.
//
// Cards renderizados com `priority={true}` porque a sessão fica
// above-the-fold antes do catálogo principal — vale fetchpriority
// alto nas thumbnails pra LCP.
function TrendingSection({ assets }: { assets: Asset[] }) {
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
}

// TopCreatorsSection: sessão "Top criadores" no topo da galeria.
// Mesma motivação visual do TrendingSection mas com cards menores
// (4 colunas independente do breakpoint maior, pra caber mais).
//
// "Ver todos" no header leva pra /criadores (diretório completo).
function TopCreatorsSection({ users }: { users: PublicUser[] }) {
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
}

// TopCreatorCard: mini-card horizontal compacto pra encaixar no grid
// 2/4 colunas. Não duplica o CreatorCard de /criadores porque aqui
// queremos algo mais denso (4 numa linha) — esse é wide e enxuto.
function TopCreatorCard({ user }: { user: PublicUser }) {
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
}

// PriceFilter: dois inputs numéricos lado a lado (Min e Max).
// inputs nativos type=number pra UX (teclado numérico em mobile) +
// validação básica de browser. Aceita vazio = sem limite.
//
// Os valores são strings (não números) aqui porque o usuário digita
// e queremos mostrar exatamente o que ele escreveu. parsePrice cuida
// da conversão na hora de filtrar.
function PriceFilter({
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
  return (
    <div
      role="group"
      aria-label="Filtrar por faixa de preço"
      className="bg-parchment border-4 border-ink shadow-pixel p-3 flex flex-wrap items-center gap-3"
    >
      <span className="text-[10px] font-bold uppercase tracking-widest text-ink/70">
        ▸ Preço (R$)
      </span>
      <label className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-ink/60">
          Min
        </span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="1"
          value={min}
          onChange={(e) => onMinChange(e.target.value)}
          placeholder="0"
          className="
            w-20 bg-white text-ink border-2 border-ink
            px-2 py-1 text-xs font-mono
            focus:outline-none focus:shadow-pixel-sm
          "
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-ink/60">
          Max
        </span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="1"
          value={max}
          onChange={(e) => onMaxChange(e.target.value)}
          placeholder="∞"
          className="
            w-20 bg-white text-ink border-2 border-ink
            px-2 py-1 text-xs font-mono
            focus:outline-none focus:shadow-pixel-sm
          "
        />
      </label>
      {(min || max) && (
        <button
          type="button"
          onClick={() => {
            onMinChange('')
            onMaxChange('')
          }}
          className="text-[10px] uppercase tracking-widest font-bold underline underline-offset-4 decoration-2 hover:text-arcane"
        >
          ✗ Limpar
        </button>
      )}
    </div>
  )
}

// parsePrice: string da URL → number em reais ou null. Aceita
// inteiro ou decimal (com . ou ,). Negativos e NaN viram null pra
// que ?min=abc não crashe.
function parsePrice(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const v = Number(raw.replace(',', '.'))
  if (!Number.isFinite(v) || v < 0) return null
  return v
}

// --- Sort helpers --------------------------------------------------
//
// Mantemos um único array SORT_OPTIONS como source-of-truth pra:
//   - validar a URL (parseSort)
//   - renderizar o dropdown (map)
//   - rotular as opções
//
// Quando uma opção nova vier (ex: "popular"), basta adicionar um item
// aqui + um case no sortAssets.

export type SortKey =
  | 'recent'
  | 'oldest'
  | 'price_asc'
  | 'price_desc'
  | 'title_asc'
  | 'title_desc'

const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'recent', label: 'Mais recentes' },
  { key: 'oldest', label: 'Mais antigos' },
  { key: 'price_asc', label: 'Preço ↑' },
  { key: 'price_desc', label: 'Preço ↓' },
  { key: 'title_asc', label: 'Título A-Z' },
  { key: 'title_desc', label: 'Título Z-A' },
]

// parseSort: aceita o que vem da URL ou null. Qualquer valor fora
// das chaves conhecidas vira o default ('recent') — protege contra
// usuário digitando ?sort=garbage e crashing.
function parseSort(raw: string | null): SortKey {
  if (!raw) return 'recent'
  return SORT_OPTIONS.some((o) => o.key === raw) ? (raw as SortKey) : 'recent'
}

// sortAssets é PURA: não muta `list`. Cria uma cópia com spread antes
// de sort() porque Array.prototype.sort in-place. Comparadores
// retornam negativo/positivo/zero — padrão JS.
//
// Tiebreaker: quando dois assets têm o mesmo valor da chave primária
// (ex: preço igual), caímos pra created_at desc (mais novo primeiro).
// Sem tiebreaker, sort do JS não é estável em todos os engines antigos.
function sortAssets(list: Asset[], key: SortKey): Asset[] {
  const copy = [...list]
  const byCreatedDesc = (a: Asset, b: Asset) =>
    b.created_at.localeCompare(a.created_at)

  switch (key) {
    case 'recent':
      return copy.sort(byCreatedDesc)
    case 'oldest':
      return copy.sort((a, b) => a.created_at.localeCompare(b.created_at))
    case 'price_asc':
      return copy.sort((a, b) => a.price_cents - b.price_cents || byCreatedDesc(a, b))
    case 'price_desc':
      return copy.sort((a, b) => b.price_cents - a.price_cents || byCreatedDesc(a, b))
    case 'title_asc':
      return copy.sort(
        (a, b) => a.title.localeCompare(b.title, 'pt-BR') || byCreatedDesc(a, b),
      )
    case 'title_desc':
      return copy.sort(
        (a, b) => b.title.localeCompare(a.title, 'pt-BR') || byCreatedDesc(a, b),
      )
  }
}
