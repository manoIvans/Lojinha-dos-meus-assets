import { useEffect, useState } from 'react'
import ModelViewer from '../components/ModelViewer'
import { api, fileUrl, type Asset } from '../api/client'

// Página de teste do ModelViewer. Puxa a lista de assets, deixa
// escolher qual modelo abrir, e renderiza o ModelViewer com a URL
// completa do .glb servido pelo backend Go.
//
// Quando o viewer for integrado à página de detalhe do asset, esta
// rota pode sair — ou ficar como um "playground" pra debug.
export default function Viewer() {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<Asset[]>('/api/v1/assets')
      .then((list) => {
        if (cancelled) return
        setAssets(list)
        // Auto-seleciona o primeiro para que o viewer já renderize
        // algo sem precisar de clique extra.
        if (list.length > 0) setSelectedId(list[0].id)
      })
      .catch(() => {
        if (!cancelled) setError('Falha ao carregar assets.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selected = assets?.find((a) => a.id === selectedId) ?? null

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="bg-parchment border-4 border-ink shadow-pixel">
        <h1 className="bg-arcane text-parchment font-pixel text-sm uppercase border-b-4 border-ink px-4 py-3">
          ▶ Viewer 3D
        </h1>

        <div className="p-4 space-y-4">
          {/* Seletor de qual asset abrir. Em produção isto vira o
              acesso direto via /asset/:id; aqui é só conveniência de
              teste pra trocar de modelo sem editar código. */}
          {assets && assets.length > 0 && (
            <label className="block text-xs uppercase tracking-wider">
              <span className="font-bold">Modelo</span>
              <select
                value={selectedId ?? ''}
                onChange={(e) => setSelectedId(Number(e.target.value))}
                className="mt-1 block w-full bg-white text-ink border-4 border-ink px-3 py-2 font-mono text-sm focus:outline-none focus:shadow-pixel-sm"
              >
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    #{a.id} — {a.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Estados de carregamento/erro/vazio */}
          {error && (
            <p className="text-xs font-bold uppercase tracking-widest text-ink/70">
              ✗ {error}
            </p>
          )}
          {!error && assets === null && (
            <p className="text-xs font-bold uppercase tracking-widest text-ink/70">
              ▌ Carregando catálogo...
            </p>
          )}
          {!error && assets?.length === 0 && (
            <p className="text-xs font-bold uppercase tracking-widest text-ink/70">
              ✦ Publique um asset primeiro para ver no viewer
            </p>
          )}

          {/* Canvas só renderiza quando há um asset selecionado. O
              Canvas em si precisa de altura definida (não cresce com
              o conteúdo); aqui damos aspect-square com borda pixel. */}
          {selected && (
            <>
              <ModelViewer
                modelUrl={fileUrl(selected.model_path)}
                className="w-full aspect-square bg-twilight border-4 border-ink"
              />
              <p className="text-xs uppercase tracking-wider text-ink/70">
                ▌ Arraste pra orbitar · scroll pra zoom · botão direito
                pra mover
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
