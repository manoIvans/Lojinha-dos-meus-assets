import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api, fileUrl, type Pack } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useCart } from '../cart/CartContext'
import { formatPrice } from '../lib/format'
import Avatar from '../components/Avatar'
import AssetCard from '../components/AssetCard'
import { useToast } from '../components/Toast'

// /pack/:id — página pública de um pack.
//
// Mostra: capa (ou placeholder), título, autor, preço, descrição,
// botão "Adicionar ao carrinho", e grid dos N assets que compõem o pack
// (mesmo card padrão da galeria).
//
// Quando o user já está logado E o pack é dele, escondemos o botão de
// adicionar (não pode comprar o próprio). Quando já está no carrinho,
// botão vira "Remover do carrinho".

export default function PackDetail() {
  const { id } = useParams<{ id: string }>()
  const { currentUserId } = useAuth()
  const { isPackInCart, togglePack } = useCart()
  const toast = useToast()

  const [pack, setPack] = useState<Pack | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)

  const load = useCallback(() => {
    if (!id) return () => {}
    setError(null)
    setPack(null)
    let cancelled = false
    api
      .get<Pack>(`/api/v1/packs/${id}`)
      .then((data) => {
        if (!cancelled) setPack(data)
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setError('Pack não encontrado.')
        } else {
          setError('Falha ao carregar pack.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    const cancel = load()
    return cancel
  }, [load])

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-ink text-parchment border-4 border-ink shadow-pixel p-8 text-center">
          <p className="text-sm font-bold uppercase tracking-widest mb-6">
            {error}
          </p>
          <Link
            to="/packs"
            className="bg-parchment text-ink border-4 border-ink shadow-pixel px-4 py-2 text-xs font-bold uppercase tracking-widest hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-75 ease-out"
          >
            ▶ Voltar pra lista
          </Link>
        </div>
      </div>
    )
  }

  if (!pack) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="bg-parchment border-4 border-ink shadow-pixel p-12 text-center animate-pulse">
          <p className="text-sm font-bold uppercase tracking-widest">
            ▌ Carregando pack...
          </p>
        </div>
      </div>
    )
  }

  const isOwner = currentUserId === pack.owner_id
  const inCart = isPackInCart(pack.id)

  const thumb =
    pack.thumbnail_path ?? pack.items?.[0]?.thumbnail_path ?? null

  async function handleToggle() {
    if (!pack) return
    setToggling(true)
    try {
      await togglePack(pack.id)
    } catch {
      toast.error('Falha ao atualizar carrinho')
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="bg-parchment border-4 border-ink shadow-pixel">
        <p className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
          ◆ Pack
        </p>
        <div className="px-6 py-5 flex flex-col md:flex-row gap-6">
          <div className="flex-shrink-0">
            {thumb ? (
              <img
                src={fileUrl(thumb)}
                alt={pack.title}
                className="w-40 h-40 object-cover border-4 border-ink shadow-pixel"
              />
            ) : (
              <div className="w-40 h-40 bg-arcane/20 border-4 border-ink shadow-pixel flex items-center justify-center font-bold uppercase tracking-widest">
                Pack
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <h1 className="text-2xl md:text-3xl font-bold uppercase tracking-wider leading-tight">
              {pack.title}
            </h1>
            {pack.author_username && (
              <Link
                to={`/u/${pack.author_username}`}
                className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink/70 hover:text-arcane w-fit"
              >
                <Avatar
                  avatarPath={pack.author_avatar_path}
                  name={pack.author_name ?? '?'}
                  size="xs"
                />
                por{' '}
                <span className="font-bold">
                  {pack.author_name ?? pack.author_username}
                </span>
              </Link>
            )}
            {pack.description && (
              <p className="text-sm leading-relaxed">{pack.description}</p>
            )}
            <p className="text-xs uppercase tracking-widest text-ink/70 font-bold">
              {pack.items?.length ?? 0}{' '}
              {(pack.items?.length ?? 0) === 1 ? 'asset' : 'assets'} ·
              economia vs soma individual
            </p>
            <div className="flex flex-wrap items-end gap-4 mt-auto">
              <p className="text-3xl font-bold">
                ✦ {formatPrice(pack.price_cents)}
              </p>
              {!isOwner && (
                <button
                  type="button"
                  onClick={handleToggle}
                  disabled={toggling}
                  className="
                    bg-ink text-parchment border-4 border-ink shadow-pixel
                    px-4 py-3 text-sm font-bold uppercase tracking-widest
                    transition-all duration-75 ease-out
                    hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
                    disabled:opacity-50
                  "
                >
                  {toggling
                    ? '...'
                    : inCart
                      ? '✗ Remover do carrinho'
                      : '⌬ Adicionar ao carrinho'}
                </button>
              )}
              {isOwner && (
                <p className="text-[10px] uppercase tracking-widest text-ink/60 font-bold">
                  ◆ Seu pack
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest mb-3 text-ink/70">
          ▸ Assets inclusos
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {(pack.items ?? []).map((asset) => (
            <AssetCard key={asset.id} asset={asset} />
          ))}
        </div>
      </section>
    </div>
  )
}
