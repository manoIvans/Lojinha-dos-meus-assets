// Token storage isolado em um módulo próprio porque DUAS coisas
// precisam ler/escrever o mesmo valor: o AuthContext (React) e a
// API helper (não-React). Manter o localStorage como fonte da
// verdade evita os dois divergirem.

const KEY = 'lojinha:token'

export const tokenStorage = {
  get(): string | null {
    return localStorage.getItem(KEY)
  },
  set(token: string): void {
    localStorage.setItem(KEY, token)
  },
  clear(): void {
    localStorage.removeItem(KEY)
  },
}
