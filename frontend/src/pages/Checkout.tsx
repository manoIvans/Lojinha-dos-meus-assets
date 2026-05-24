import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, api, type CheckoutSession } from '../api/client'
import { formatPrice } from '../lib/format'
import { useToast } from '../components/Toast'

// /checkout/:sessionId: página STUB que simula o provedor de pagamento
// (Stripe Checkout / MercadoPago Preference). Em produção esta tela
// não existe — o backend devolveria uma URL externa e o usuário sairia
// do app. Aqui ela serve pra que o fluxo seja end-to-end testável sem
// integrar gateway real.
//
// Quando Stripe/MP entrarem, esta rota é substituída por um redirect
// externo: `window.location = session.provider_redirect_url`. O endpoint
// confirm continua atendendo o webhook que vem do provedor.
//
// Fluxo:
//  1. Carrega a sessão (GET /my/checkout/sessions/:id). 404 = redirect /carrinho.
//  2. Mostra "Pagar R$ X via STUB" + botão "Pagar agora".
//  3. Click → POST /confirm → success → navigate /library.

export default function Checkout() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const [session, setSession] = useState<CheckoutSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)

  const load = useCallback(() => {
    if (!sessionId) return () => {}
    setError(null)
    setSession(null)
    let cancelled = false

    api
      .get<CheckoutSession>(`/api/v1/my/checkout/sessions/${sessionId}`)
      .then((data) => {
        if (cancelled) return
        // Sessão já paga? Pula direto pra library — o usuário pode ter
        // dado refresh depois de confirmar.
        if (data.status === 'paid') {
          navigate('/library', { replace: true })
          return
        }
        setSession(data)
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setError('Sessão de pagamento não encontrada.')
        } else {
          setError('Falha ao carregar sessão.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, navigate])

  useEffect(() => {
    const cancel = load()
    return cancel
  }, [load])

  async function handleConfirm() {
    if (!sessionId) return
    setPaying(true)
    try {
      await api.post<CheckoutSession>(
        `/api/v1/my/checkout/sessions/${sessionId}/confirm`,
      )
      toast.success('Pagamento confirmado')
      navigate('/library', { replace: true })
    } catch (err) {
      toast.error(messageForConfirm(err))
      setPaying(false)
    }
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-ink text-parchment border-4 border-ink shadow-pixel p-8 text-center">
          <p className="text-sm font-bold uppercase tracking-widest mb-6">
            {error}
          </p>
          <button
            onClick={() => navigate('/carrinho', { replace: true })}
            className="
              bg-parchment text-ink border-4 border-ink shadow-pixel
              px-4 py-2 text-xs font-bold uppercase tracking-widest
              transition-all duration-75 ease-out
              hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
            "
          >
            ▶ Voltar ao carrinho
          </button>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-parchment border-4 border-ink shadow-pixel p-8 text-center animate-pulse">
          <p className="text-sm font-bold uppercase tracking-widest">
            ▌ Conectando ao gateway...
          </p>
        </div>
      </div>
    )
  }

  const itemCount = session.purchase_ids?.length ?? 0

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <header className="bg-parchment border-4 border-ink shadow-pixel">
        <p className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
          ▶ Gateway de pagamento
        </p>
        <div className="px-6 py-5">
          <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight">
            Confirme seu pagamento
          </h1>
          <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
            ▸ Provedor: <span className="font-bold">{session.provider}</span>{' '}
            (sandbox)
          </p>
        </div>
      </header>

      <div className="bg-parchment border-4 border-ink shadow-pixel p-6 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="uppercase tracking-widest text-ink/70 font-bold">
            Itens
          </span>
          <span className="font-bold">
            {itemCount} {itemCount === 1 ? 'asset' : 'assets'}
          </span>
        </div>
        <div className="flex items-center justify-between border-t-2 border-ink pt-4">
          <span className="uppercase tracking-widest text-ink/70 font-bold">
            Total
          </span>
          <span className="text-2xl font-bold">
            ✦ {formatPrice(session.total_cents)}
          </span>
        </div>
        <p className="text-[10px] uppercase tracking-widest text-ink/60 leading-relaxed">
          ▸ Esta página simula o checkout do provedor. No fluxo real, você
          seria redirecionado a uma URL externa (Stripe/MercadoPago) e
          voltaria via webhook após pagar.
        </p>
      </div>

      <div className="bg-twilight text-parchment border-4 border-ink shadow-pixel p-5 flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs uppercase tracking-widest text-parchment/70">
          Sessão {session.id.slice(0, 8)}…
        </p>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={paying}
          className="
            bg-parchment text-ink border-4 border-ink shadow-pixel
            px-4 py-3 text-sm font-bold uppercase tracking-widest
            transition-all duration-75 ease-out
            hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
            disabled:opacity-50 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-pixel
          "
        >
          {paying ? '...' : '▶ Pagar agora'}
        </button>
      </div>

      <button
        type="button"
        onClick={() => navigate('/carrinho', { replace: true })}
        className="
          block mx-auto text-xs uppercase tracking-widest font-bold
          underline underline-offset-4 decoration-2
          text-ink/70 hover:text-arcane
        "
      >
        ✗ Cancelar e voltar ao carrinho
      </button>
    </div>
  )
}

function messageForConfirm(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 410) return 'Sessão expirada — refaça o checkout'
    if (err.status === 409) return 'Esta compra já foi feita em outra sessão'
    if (err.status === 404) return 'Sessão não encontrada'
  }
  return 'Falha ao confirmar pagamento'
}
