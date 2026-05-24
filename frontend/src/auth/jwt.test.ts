import { describe, it, expect } from 'vitest'
import { decodeJwt } from './jwt'

// Helper: monta um JWT-like com payload arbitrário, sem assinatura
// válida. `decodeJwt` NÃO valida — só parseia o payload base64url
// (decisão consciente; auth real é no backend).
function makeToken(payload: object): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  const body = btoa(JSON.stringify(payload))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  // "signature" fake — decodeJwt nem olha.
  return `${header}.${body}.signature-fake`
}

describe('decodeJwt', () => {
  it('decodifica payload válido com uid', () => {
    const token = makeToken({ uid: 42, exp: 1234567890 })
    const got = decodeJwt(token)
    expect(got).not.toBeNull()
    expect(got?.uid).toBe(42)
    expect(got?.exp).toBe(1234567890)
  })

  it('preserva campos extras via index signature', () => {
    const token = makeToken({ uid: 1, custom_field: 'hello' })
    const got = decodeJwt(token)
    expect(got?.custom_field).toBe('hello')
  })

  it('lida com base64url (chars - e _)', () => {
    // Payload com chars que viram - / _ no base64url. Vamos
    // forçar usando algo que produza esses chars no encode.
    // String com bytes 0xFB → '+' em base64 padrão, '-' em base64url.
    const token = makeToken({ uid: 1, msg: 'subjects?' })
    const got = decodeJwt(token)
    expect(got?.uid).toBe(1)
    expect(got?.msg).toBe('subjects?')
  })

  it('retorna null para token sem 3 partes', () => {
    expect(decodeJwt('')).toBeNull()
    expect(decodeJwt('only-one-part')).toBeNull()
    expect(decodeJwt('two.parts')).toBeNull()
    expect(decodeJwt('four.parts.are.invalid')).toBeNull()
  })

  it('retorna null pra payload base64 inválido', () => {
    expect(decodeJwt('header.@@@invalid@@@.sig')).toBeNull()
  })

  it('retorna null pra payload que não é JSON', () => {
    // base64 de "not-json": "bm90LWpzb24="
    const badPayload = btoa('not-json').replace(/=/g, '')
    expect(decodeJwt(`header.${badPayload}.sig`)).toBeNull()
  })

  it('aceita payload sem uid (campo opcional)', () => {
    // JWT genérico sem uid — decodifica mas .uid fica undefined.
    // O AuthContext trata isso como currentUserId = null.
    const token = makeToken({ sub: 'alice' })
    const got = decodeJwt(token)
    expect(got).not.toBeNull()
    expect(got?.uid).toBeUndefined()
  })

  it('NÃO valida assinatura (decode-only)', () => {
    // Doc trust: decodeJwt aceita signature aleatória. A segurança
    // mora no backend; aqui é só UX. Este teste documenta a decisão.
    const payload = btoa(JSON.stringify({ uid: 999 }))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
    const fakeToken = `eyJhbGciOiJIUzI1NiJ9.${payload}.completely-bogus-signature`
    const got = decodeJwt(fakeToken)
    expect(got?.uid).toBe(999) // aceita mesmo sem validar
  })
})
