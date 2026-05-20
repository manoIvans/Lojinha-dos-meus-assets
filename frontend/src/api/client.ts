import { tokenStorage } from '../auth/tokenStorage'

// BASE_URL vem da env (VITE_API_BASE_URL). Falha alta e cedo se a env
// não estiver configurada — melhor um erro óbvio no boot do que
// requests indo pra `undefined/api/v1/...` com mensagens confusas.
const BASE_URL = import.meta.env.VITE_API_BASE_URL
if (!BASE_URL) {
  throw new Error(
    'VITE_API_BASE_URL não definida. Crie um .env baseado no .env.example.',
  )
}

// ApiError carrega o status HTTP e o corpo da resposta para que o
// componente decida como reagir (ex: 401 → logout, 422 → mostrar
// mensagem de validação). Manter como classe permite `instanceof`
// no try/catch sem virar genérico.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`HTTP ${status}`)
  }
}

// Shape do retorno do backend Go. Mantidos em snake_case porque é
// como o JSON chega — converter pra camelCase aqui exigiria mapeamento
// em toda chamada. Conviver com snake_case é mais barato.
//
// author_name é opcional porque o backend só popula no List (com
// JOIN em users). Outros endpoints omitem o campo via omitempty.
//
// tags substituiu category (migration 004) — agora multi-valor.
// Sempre array não-nulo (default '{}' no schema).
// TagCount é o par tag→quantidade-de-assets devolvido por GET /tags.
// Usado pela galeria pra mostrar "fantasia (12)" no chip do filtro.
export type TagCount = {
  tag: string
  count: number
}

// User é o shape COMPLETO (com email) devolvido em GET /users/me e
// no objeto `user` da resposta de register. NUNCA chega pra terceiros
// — o backend só responde isso pra rota autenticada do próprio dono.
//
// avatar_path é opcional + nullable: o backend devolve `null` quando
// o usuário não tem avatar (e omite o campo se nem o User foi feito
// JOIN). Tratar `null` e `undefined` no front como "sem avatar".
export type User = {
  id: number
  email: string
  username: string
  display_name: string
  bio: string
  avatar_path?: string | null
  created_at: string
  updated_at: string
}

// PublicUser é o shape devolvido por GET /users/:username e
// GET /users. Sem email, sem updated_at — alimenta /u/:username
// e o diretório /criadores.
//
// asset_count vem populado em GET /users (lista) mas omitido em
// GET /users/:username (perfil individual) — o backend só calcula
// quando faz sentido pro caller.
export type PublicUser = {
  id: number
  username: string
  display_name: string
  bio: string
  avatar_path?: string | null
  asset_count?: number
  created_at: string
}

// Purchase é o registro IMUTÁVEL de uma compra. price_cents_snapshot
// preserva o preço pago — não muda mesmo que o vendedor reajuste o
// preço do asset depois. `asset` é nullable: se o vendedor deletou,
// permanece o registro (sem o conteúdo).
export type Purchase = {
  id: number
  user_id: number
  price_cents_snapshot: number
  purchased_at: string
  asset?: Asset | null
}

export type Asset = {
  id: number
  owner_id: number
  title: string
  description: string
  tags: string[]
  price_cents: number
  thumbnail_path: string
  model_path: string
  // Campos desnormalizados do autor (via JOIN no backend).
  // author_name = display_name; author_username permite link pra
  // /u/:username; author_avatar_path null quando o autor não tem
  // foto de perfil. Os 3 podem vir ausentes em respostas que não
  // fazem JOIN (ex: Create).
  author_name?: string
  author_username?: string
  author_avatar_path?: string | null
  created_at: string
  updated_at: string
}

type RequestBody = FormData | Record<string, unknown> | undefined

// onUnauthorized é um callback global disparado QUANDO uma request
// recebe 401. Usado pelo AuthInterceptor pra forçar logout +
// redirect quando o JWT expira ou é revogado.
//
// Por que callback em vez de jogar o erro pro caller:
//   - 401 não-tratado em cada handler vira boilerplate massivo
//   - Logout é um efeito colateral global que TODA tela precisa
//     reagir igual (limpar contextos, redirecionar)
//   - Registrar uma vez no boot do App é a forma DRY
//
// Tipos exportados pra que o componente registrar o callback fique
// type-safe.
type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null

export function setOnUnauthorized(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler
}

// Rotas onde 401 NÃO deve disparar logout global — são endpoints de
// login/register cuja falha (credencial errada) é responsabilidade
// da própria tela tratar. Sem este filtro, errar a senha derrubaria
// o usuário do login pro login com mensagem de "sessão expirada",
// que é confuso.
const AUTH_PATHS_NO_LOGOUT = ['/api/v1/login', '/api/v1/register']

// request é a única função que faz fetch. Toda chamada da app passa
// por aqui — é o lugar para auth, base URL, parsing e tratamento de
// erro. Manter centralizado evita "esqueci de mandar o token nesse
// fetch específico".
async function request<T>(
  method: string,
  path: string,
  body?: RequestBody,
): Promise<T> {
  const headers: Record<string, string> = {}

  // Injeta Authorization automaticamente quando há token. Lê do
  // localStorage a cada call — assim, logout durante uma sessão
  // não vaza o token para requests subsequentes.
  const token = tokenStorage.get()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let fetchBody: BodyInit | undefined
  if (body instanceof FormData) {
    // NUNCA setar Content-Type manualmente em multipart: o fetch
    // precisa escrever o boundary correto, e o navegador faz isso
    // sozinho quando o body é um FormData. Forçar quebra o upload.
    fetchBody = body
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    fetchBody = JSON.stringify(body)
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: fetchBody,
  })

  // 204 No Content (ex: DELETE) — não tem corpo, devolve undefined.
  if (res.status === 204) {
    return undefined as T
  }

  const responseBody = await parseBody(res)

  if (!res.ok) {
    // 401 em endpoints autenticados → dispara o handler global ANTES
    // de jogar o erro. O handler faz logout + redirect; o caller
    // ainda recebe o erro pra que toasts/loaders limpem o estado.
    if (
      res.status === 401 &&
      onUnauthorized &&
      !AUTH_PATHS_NO_LOGOUT.includes(path)
    ) {
      onUnauthorized()
    }
    throw new ApiError(res.status, responseBody)
  }
  return responseBody as T
}

// parseBody decide entre JSON e texto pelo Content-Type. Defensivo:
// um 500 do servidor pode vir como HTML, e tentar res.json() nele
// crasha em vez de devolver a mensagem útil.
async function parseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get('Content-Type') ?? ''
  if (contentType.includes('application/json')) {
    return res.json()
  }
  return res.text()
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: RequestBody) => request<T>('POST', path, body),
  put: <T>(path: string, body?: RequestBody) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: RequestBody) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

// fileUrl monta a URL absoluta do arquivo servido pela rota estática
// /uploads/* da API. Tag <img> e loaders do three.js usam isso direto.
export function fileUrl(relPath: string): string {
  return `${BASE_URL}/uploads/${relPath}`
}
