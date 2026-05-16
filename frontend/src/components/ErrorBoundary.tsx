import { Component, type ErrorInfo, type ReactNode } from 'react'

// ErrorBoundary captura erros de render/lifecycle dos filhos. Sem ela,
// um throw inesperado deixa a página em branco e o usuário precisa
// recarregar para conseguir voltar.
//
// Limitações (do React, não nossas):
//   - NÃO captura erros em handlers async (promise rejeitada em
//     onClick). Para esses, try/catch local continua necessário.
//   - NÃO captura erros do próprio ErrorBoundary.
//
// Continua como class component porque o React não tem hook
// equivalente a getDerivedStateFromError / componentDidCatch.

type State = { error: Error | null }
type Props = { children: ReactNode }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Em produção, é aqui que vai o envio para Sentry/etc.
    // console.error garante que pelo menos aparece no DevTools.
    console.error('ErrorBoundary capturou:', error, info.componentStack)
  }

  handleReset = () => {
    // Reset puro de estado: se a falha era transiente (rede, race),
    // volta ao normal. Se for bug determinístico, cai aqui de novo.
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center bg-twilight text-ink font-mono p-6">
        <div className="max-w-md w-full bg-parchment border-4 border-ink shadow-pixel">
          <h1 className="bg-ink text-parchment text-sm font-bold uppercase tracking-widest border-b-4 border-ink px-4 py-3 text-center">
            ✗ Game Over
          </h1>

          <div className="p-6 text-center space-y-4">
            <p className="text-xs uppercase tracking-wider">
              Erro inesperado na página
            </p>

            <pre className="bg-ink text-parchment text-[10px] p-3 text-left overflow-auto whitespace-pre-wrap break-words border-4 border-ink">
              {this.state.error.message}
            </pre>

            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={this.handleReset}
                className="
                  bg-arcane text-parchment border-4 border-ink shadow-pixel
                  px-4 py-2 text-xs font-bold uppercase tracking-widest
                  transition-all duration-75 ease-out
                  hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
                "
              >
                ▶ Continuar
              </button>
              <a
                href="/"
                className="
                  bg-parchment text-ink border-4 border-ink shadow-pixel
                  px-4 py-2 text-xs font-bold uppercase tracking-widest
                  transition-all duration-75 ease-out
                  hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none
                "
              >
                ◀ Galeria
              </a>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
