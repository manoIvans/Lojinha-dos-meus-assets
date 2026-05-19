import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

// Backend tem dois endpoints simétricos (ambos retornam {token}):
//   POST /api/v1/login     → { token }
//   POST /api/v1/register  → { user, token }
// Toggle local decide qual chamar — uma rota /register dedicada só
// duplicaria o formulário.
type Mode = 'login' | 'register'
type AuthResponse = { token: string }

// Classes reutilizadas em todos os botões "principais": borda grossa,
// sombra pixel, hover-press. Extraídas em const para evitar drift
// quando ajustarmos a estética (ex: trocar offset da sombra).
const PIXEL_BTN =
  'border-4 border-ink shadow-pixel px-4 py-2 font-bold uppercase tracking-widest ' +
  'transition-all duration-75 ease-out ' +
  'hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none ' +
  'disabled:opacity-50 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-pixel'

const PIXEL_INPUT =
  'mt-1 block w-full bg-white text-ink border-4 border-ink px-3 py-2 ' +
  'font-mono focus:outline-none focus:shadow-pixel-sm'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Se veio do ProtectedRoute, volta para o destino original.
  const redirectTo =
    (location.state as { from?: { pathname: string } } | null)?.from?.pathname ??
    '/dashboard'

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Username e display_name só importam no modo register. Mantemos
  // sempre no state mesmo no login pra que o toggle de modo preserve
  // o que o usuário já digitou (UX: não perde texto ao alternar).
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const path = mode === 'login' ? '/api/v1/login' : '/api/v1/register'
    // Body diferente por modo: login só email/password, register
    // também manda username (sanitizado lowercase pra casar com a
    // regra do backend) e display_name.
    const body =
      mode === 'login'
        ? { email, password }
        : {
            email,
            password,
            username: username.trim().toLowerCase(),
            display_name: displayName.trim(),
          }
    try {
      const { token } = await api.post<AuthResponse>(path, body)
      login(token)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(messageFor(err, mode))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm mt-12 p-6">
      <div className="bg-parchment border-4 border-ink shadow-pixel">
        <h1 className="bg-arcane text-parchment text-sm font-bold uppercase tracking-widest border-b-4 border-ink px-4 py-3">
          ▶ {mode === 'login' ? 'Entrar' : 'Criar Conta'}
        </h1>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Username + Display name só aparecem no register. Vêm
              ANTES do email porque definem identidade na app — email
              vira credencial e fica perto da senha. */}
          {mode === 'register' && (
            <>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider">
                  Nome de exibição
                </span>
                <input
                  type="text"
                  required
                  minLength={1}
                  maxLength={60}
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={PIXEL_INPUT}
                />
                <span className="text-[10px] uppercase tracking-wider mt-1 block">
                  Como você quer aparecer (até 60 chars)
                </span>
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wider">
                  Username
                </span>
                <input
                  type="text"
                  required
                  minLength={1}
                  maxLength={30}
                  pattern="[A-Za-z0-9_]{1,30}"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={PIXEL_INPUT}
                  placeholder="ex: manoivans"
                />
                <span className="text-[10px] uppercase tracking-wider mt-1 block">
                  Letras minúsculas, números e _ (até 30). Define a URL
                  /u/seu-handle
                </span>
              </label>
            </>
          )}

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider">
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={PIXEL_INPUT}
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider">
              Senha
            </span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={PIXEL_INPUT}
            />
            {mode === 'register' && (
              <span className="text-[10px] uppercase tracking-wider mt-1 block">
                Mínimo 8 caracteres
              </span>
            )}
          </label>

          {error && (
            <div
              role="alert"
              className="bg-ink text-parchment border-4 border-ink shadow-pixel-sm p-3 text-xs font-bold uppercase tracking-wider"
            >
              ✗ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={`${PIXEL_BTN} w-full bg-arcane text-parchment text-sm`}
          >
            {submitting
              ? '...'
              : mode === 'login'
                ? '▶ Entrar'
                : '▶ Criar conta'}
          </button>
        </form>

        <div className="border-t-4 border-ink px-6 py-3 text-xs uppercase tracking-wider">
          {mode === 'login' ? 'Sem conta?' : 'Já tem conta?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError(null)
            }}
            className="font-bold underline underline-offset-4 decoration-2 hover:text-arcane"
          >
            {mode === 'login' ? 'Criar agora' : 'Entrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// messageFor traduz erro da API em algo legível. Mantemos por página
// porque cada tela quer um wording próprio.
function messageFor(err: unknown, mode: Mode): string {
  if (err instanceof ApiError) {
    if (mode === 'login' && err.status === 401) return 'Credenciais inválidas'
    // 409 pode ser email OU username (backend distingue na mensagem).
    // Repassamos o body.error pro usuário ver qual.
    if (mode === 'register' && err.status === 409) {
      const body = err.body as { error?: string } | string
      if (typeof body === 'object' && body?.error) return body.error
      return 'Conta já cadastrada'
    }
    const body = err.body as { error?: string } | string
    if (typeof body === 'object' && body?.error) return body.error
  }
  return 'Falha de rede'
}
