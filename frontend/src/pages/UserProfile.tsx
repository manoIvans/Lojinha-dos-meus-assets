import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api, type Asset, type PublicUser } from '../api/client'
import AssetCard from '../components/AssetCard'
import AssetCardSkeleton from '../components/AssetCardSkeleton'
import Avatar from '../components/Avatar'

// /u/:username: perfil PÚBLICO de um usuário + grid dos assets dele.
//
// Carrega dois recursos em paralelo:
//   - GET /api/v1/users/:username → PublicUser (sem email)
//   - GET /api/v1/assets ... filtrado por author_username
//     ↑ Backend ainda não tem rota dedicada "assets by username".
//       Filtramos client-side a partir do List. Quando o catálogo
//       crescer, vira /api/v1/users/:username/assets.
//
// Diferentemente de /perfil/me, NÃO há edição aqui — qualquer um
// (logado ou não) pode visitar. UI espelha a estética de Gallery e
// MyStore: hero + grid de cards.

const SKELETON_COUNT = 4
const GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6'

export default function UserProfile() {
  const { username } = useParams<{ username: string }>()
  const [user, setUser] = useState<PublicUser | null>(null)
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!username) {
      setNotFound(true)
      return
    }

    let cancelled = false
    setUser(null)
    setAssets(null)
    setError(null)
    setNotFound(false)

    // Promise.all dispara os dois em paralelo. Se SÓ o user 404, o
    // catch identifica e mostra notFound. Falha no /assets (deveria
    // ser quase nunca) cai no erro genérico.
    Promise.all([
      api.get<PublicUser>(`/api/v1/users/${username}`),
      api.get<Asset[]>('/api/v1/assets'),
    ])
      .then(([userData, allAssets]) => {
        if (cancelled) return
        setUser(userData)
        // Filtra os assets pelo username do autor. Comparação direta
        // — username é case-insensitive na convenção do banco (sempre
        // lowercase), e o que vem em /api/v1/users já é normalizado.
        setAssets(
          allAssets.filter((a) => a.author_username === userData.username),
        )
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true)
        } else {
          setError('Falha ao carregar o perfil')
        }
      })

    return () => {
      cancelled = true
    }
  }, [username])

  if (notFound) return <NotFoundState username={username ?? ''} />
  if (error) return <ErrorState message={error} />

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <Hero user={user} assetCount={assets?.length ?? null} />
      <Content assets={assets} />
    </div>
  )
}

function Hero({
  user,
  assetCount,
}: {
  user: PublicUser | null
  assetCount: number | null
}) {
  return (
    <header className="bg-parchment border-4 border-ink shadow-pixel">
      <p className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
        ▶ Aventureiro
      </p>
      <div className="px-6 py-5 flex flex-wrap items-center gap-5">
        <Avatar
          avatarPath={user?.avatar_path}
          name={user?.display_name ?? '?'}
          size="lg"
        />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight break-words">
            {user?.display_name ?? '...'}
          </h1>
          <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
            ▸ @{user?.username ?? '...'}
            {assetCount !== null && (
              <>
                {' · '}
                {assetCount === 1
                  ? '1 asset publicado'
                  : `${assetCount} assets publicados`}
              </>
            )}
          </p>
          {user?.bio && user.bio.trim().length > 0 && (
            <p className="text-sm text-ink/80 mt-3 leading-relaxed whitespace-pre-wrap">
              {user.bio}
            </p>
          )}
        </div>
      </div>
    </header>
  )
}

function Content({ assets }: { assets: Asset[] | null }) {
  if (assets === null) {
    return (
      <div className={GRID_CLASSES} aria-busy="true" aria-live="polite">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <AssetCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (assets.length === 0) {
    return (
      <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center">
        <p className="text-5xl mb-4" aria-hidden="true">
          ✦
        </p>
        <p className="text-sm font-bold uppercase tracking-widest">
          Nenhum asset publicado
        </p>
      </div>
    )
  }

  return (
    <div className={GRID_CLASSES}>
      {assets.map((asset, i) => (
        <AssetCard key={asset.id} asset={asset} priority={i < 4} />
      ))}
    </div>
  )
}

function NotFoundState({ username }: { username: string }) {
  return (
    <div className="max-w-md mx-auto mt-16 p-6">
      <div className="bg-parchment border-4 border-ink shadow-pixel p-8 text-center">
        <p className="text-4xl mb-4" aria-hidden="true">
          ✗
        </p>
        <p className="text-sm font-bold uppercase tracking-widest mb-2">
          Usuário não encontrado
        </p>
        <p className="text-xs text-ink/70 tracking-wider mb-6 break-all">
          @{username} não existe no catálogo.
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
        <p className="text-sm font-bold uppercase tracking-widest">
          {message}
        </p>
      </div>
    </div>
  )
}
