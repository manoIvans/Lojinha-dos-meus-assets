// Decodifica o payload de um JWT SEM VALIDAR a assinatura. Usado
// EXCLUSIVAMENTE pra UX (mostrar/esconder botões do dono).
//
// A autoridade final é o backend, que valida HMAC + expiração a cada
// request protegida. Mesmo que alguém forje um user_id aqui, o
// servidor rejeita qualquer ação de owner-only quando a assinatura
// não bate. Em outras palavras: este decode é "best effort UX"; a
// segurança não depende dele.
//
// Estrutura do JWT: header.payload.signature, todos base64url-encoded.
// Só nos importa o payload (segunda parte).

export type JwtPayload = {
  user_id?: number
  exp?: number
  iat?: number
  [key: string]: unknown
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const payload = parts[1]
    // base64url usa - e _ em vez de + e /; converte antes de atob().
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    // base64 precisa de comprimento múltiplo de 4 — adiciona padding.
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)

    return JSON.parse(atob(padded)) as JwtPayload
  } catch {
    // Token mal formado, base64 inválido, JSON corrompido — qualquer
    // erro: devolve null. O caller trata como "sem identidade".
    return null
  }
}
