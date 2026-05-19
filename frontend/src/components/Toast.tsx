import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

// Sistema de toasts: notificações temporárias empilhadas num canto da
// tela. Padrão "fire and forget" — o caller chama toast.success(...) e
// segue a vida; o provider cuida de renderizar e auto-fechar.
//
// Por que não usar uma lib pronta (sonner, react-hot-toast)?
//   - O visual pixel-art exige customização total. Lib pronta vem com
//     CSS opinado que brigaria com tailwind/tokens nossos.
//   - É ~150 linhas. Lib resolveria, mas com 30 KB no bundle.
//
// API pública (useToast):
//   const { success, error, info } = useToast()
//   success('Asset salvo')       // mensagem curta
//   error('Falha ao excluir')    // mesma assinatura
//   info('Conteúdo público')     // raramente usado
//
// Estado dos toasts:
//   - Cada toast tem id único (counter incremental, suficiente pra UI)
//   - Auto-dismiss depois de DEFAULT_TTL_MS (4s)
//   - Botão × pra fechar antes
//   - Empilham bottom→up no canto inferior direito

type ToastVariant = 'success' | 'error' | 'info'

type Toast = {
  id: number
  variant: ToastVariant
  message: string
}

type ToastApi = {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const DEFAULT_TTL_MS = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  // ref pro counter porque queremos um ID monotonicamente crescente
  // sem causar re-render quando ele incrementa. useState daria o ID
  // mas re-renderizaria o provider à toa.
  const nextIdRef = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // push é a primitiva. As variantes são açúcar por cima dela.
  const push = useCallback((variant: ToastVariant, message: string) => {
    const id = nextIdRef.current++
    setToasts((prev) => [...prev, { id, variant, message }])
    // Auto-dismiss. Se o toast já foi removido manualmente, o filter
    // no setToasts é no-op — não precisa de cleanup explícito do timer.
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, DEFAULT_TTL_MS)
  }, [])

  // useMemo pro objeto da API: senão todo consumer re-renderizaria a
  // cada push (mesma razão do AuthContext).
  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast precisa estar dentro de <ToastProvider>')
  }
  return ctx
}

// ToastViewport: portal-like, fixo na tela. Z alto pra ficar acima de
// qualquer modal/sticky. aria-live=polite garante que leitores de tela
// anunciem novos toasts sem interromper o foco atual.
function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-xs"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  )
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: () => void
}) {
  // Anima entrada (slide-in da direita). Roda só na montagem — useState
  // inicial=false + useEffect que liga em true no próximo frame.
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    // requestAnimationFrame garante que o estado inicial é pintado
    // ANTES do toggle pra true. Sem isso, o browser pode pular o
    // transition (já entra com visible=true).
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Variante define cor de fundo + ícone. Bordas/sombra são iguais
  // pra manter coerência visual com o resto da UI pixel-art.
  const palette = variantPalette(toast.variant)

  return (
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      className={`
        pointer-events-auto
        border-4 border-ink shadow-pixel
        px-3 py-2 flex items-start gap-2
        transition-all duration-150 ease-out
        ${palette.bg} ${palette.text}
        ${visible ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'}
      `}
    >
      <span aria-hidden="true" className="font-bold text-sm leading-none mt-0.5">
        {palette.icon}
      </span>
      <span className="text-xs font-bold uppercase tracking-wider leading-snug flex-1">
        {toast.message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fechar notificação"
        className="font-bold text-base leading-none hover:opacity-70 -mt-0.5"
      >
        ×
      </button>
    </div>
  )
}

function variantPalette(v: ToastVariant): {
  bg: string
  text: string
  icon: string
} {
  switch (v) {
    case 'success':
      return { bg: 'bg-arcane', text: 'text-parchment', icon: '★' }
    case 'error':
      return { bg: 'bg-ink', text: 'text-parchment', icon: '✗' }
    case 'info':
      return { bg: 'bg-twilight', text: 'text-parchment', icon: '▸' }
  }
}
