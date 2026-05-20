import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// ScrollToTop: reseta window.scrollY pra 0 quando o pathname muda
// VIA navegação explícita (PUSH/REPLACE — clicar em link, navigate()).
// Em POP (back/forward do browser), o navegador tem sua própria
// scroll restoration que preserva a posição anterior — não devemos
// forçar o topo nesse caso.
//
// React Router v6 NÃO faz isso por padrão (decisão de design: alguns
// apps querem preservar scroll). Pra marketplace — clicar num asset
// → abrir detalhe — esperamos começar do topo. Mas hit back deveria
// voltar pra onde estava na galeria.
//
// Ignoramos mudanças apenas de search params (filtros da galeria):
// trocar tag não deve fazer o scroll voltar pro topo. Por isso a
// dep array tem só pathname, não location inteira.
export default function ScrollToTop() {
  const { pathname } = useLocation()
  const navType = useNavigationType()

  useEffect(() => {
    // POP = back/forward button. PUSH = navigate()/<Link>. REPLACE =
    // navigate(.., { replace: true }) tipo login redirect.
    if (navType === 'POP') return

    // 'instant' (não 'smooth') porque o usuário acabou de navegar —
    // animar o scroll dá sensação de "loading" desnecessária.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, navType])

  return null
}
