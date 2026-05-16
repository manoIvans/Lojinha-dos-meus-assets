import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

// O backend tem dois endpoints:
//   POST /api/v1/login     → { token }
//   POST /api/v1/register  → { user, token }
//
// Ambos retornam token, então o fluxo é idêntico do ponto de vista
// do frontend. Um toggle local decide qual chamar — evita ter uma
// rota separada /register que só duplica o formulário.
type Mode = 'login' | 'register'

type AuthResponse = { token: string }

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Se o usuário foi mandado pra cá pelo ProtectedRoute, devolve ele
  // ao destino original. Caso contrário, vai pro dashboard.
  const redirectTo =
    (location.state as { from?: { pathname: string } } | null)?.from?.pathname ??
    '/dashboard'

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const path = mode === 'login' ? '/api/v1/login' : '/api/v1/register'
    try {
      const { token } = await api.post<AuthResponse>(path, { email, password })
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
      <h1 className="text-2xl font-semibold mb-6">
        {mode === 'login' ? 'Entrar' : 'Criar conta'}
      </h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 focus:border-black focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Senha</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 focus:border-black focus:outline-none"
          />
          {mode === 'register' && (
            <span className="text-xs text-gray-500 mt-1 block">
              Mínimo 8 caracteres.
            </span>
          )}
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-black text-white py-2 font-medium disabled:opacity-50"
        >
          {submitting
            ? 'Enviando...'
            : mode === 'login'
              ? 'Entrar'
              : 'Criar conta'}
        </button>
      </form>

      <p className="mt-6 text-sm text-gray-600">
        {mode === 'login' ? 'Ainda não tem conta?' : 'Já tem conta?'}{' '}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
          }}
          className="underline hover:text-black"
        >
          {mode === 'login' ? 'Criar agora' : 'Entrar'}
        </button>
      </p>
    </div>
  )
}

// messageFor traduz o erro da API em algo legível. Mantemos perto da
// página em vez de no client porque cada tela quer um wording próprio.
function messageFor(err: unknown, mode: Mode): string {
  if (err instanceof ApiError) {
    if (mode === 'login' && err.status === 401) return 'Credenciais inválidas.'
    if (mode === 'register' && err.status === 409) {
      return 'Esse email já está cadastrado.'
    }
    const body = err.body as { error?: string } | string
    if (typeof body === 'object' && body?.error) return body.error
  }
  return 'Falha de rede. Tente novamente.'
}
