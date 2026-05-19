import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Canvas } from '@react-three/fiber'
import {
  Center,
  ContactShadows,
  Environment,
  Html,
  OrbitControls,
  useGLTF,
} from '@react-three/drei'
import type { Material, Mesh } from 'three'

// ModelViewer: container 3D com toggles de inspeção.
//
// Controles sobrepostos (overlay) no canto superior direito:
//   - Fullscreen: usa Fullscreen API (requestFullscreen no container).
//     Esc nativo do browser sai; o botão alterna manualmente.
//   - Wireframe: traverse na cena e seta material.wireframe em cada
//     mesh. Permite inspecionar a retopologia.
//   - Resetar câmera: chama OrbitControls.reset() pra voltar à pose
//     inicial (position=[3,3,3] olhando pra origem).
//
// Atalhos de teclado (quando o viewer tem foco — tabIndex=0):
//   F → fullscreen on/off
//   W → wireframe on/off
//   R → reset camera
// Foco visual via outline arcane pra deixar claro que o viewer
// está escutando teclado. Globais NÃO — isso conflitaria com os
// outros componentes da app.
//
// Geometria/iluminação inalteradas em relação à versão anterior:
//   Environment 'city' (IBL/PBR), ContactShadows no chão, key light
//   com castShadow, <Center bottom> alinhando a base do modelo a y=0.

type Props = {
  modelUrl: string
  className?: string
}

// Tipo do ref do OrbitControls inferido via ComponentRef pra evitar
// import direto de `three-stdlib` (transitive da drei).
type ControlsRef = ComponentRef<typeof OrbitControls>

// Classes reutilizadas entre os botões do overlay — extraídas em
// const pra uniformizar tamanho/sombra/transição sem repetição.
const OVERLAY_BTN =
  'pointer-events-auto border-2 border-ink shadow-pixel-sm ' +
  'px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ' +
  'transition-all duration-75 ease-out ' +
  'hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none ' +
  'active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'

export default function ModelViewer({ modelUrl, className }: Props) {
  const [isWireframe, setIsWireframe] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const controlsRef = useRef<ControlsRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // OrbitControls.reset() restaura a câmera ao "saved state". O drei
  // captura esse state automaticamente na primeira renderização — não
  // precisamos chamar saveState() manualmente.
  const resetCamera = useCallback(() => {
    controlsRef.current?.reset()
  }, [])

  const toggleWireframe = useCallback(() => {
    setIsWireframe((v) => !v)
  }, [])

  // toggleFullscreen: requestFullscreen no container (não no Canvas)
  // pra que o overlay de botões ENTRE em fullscreen junto. Caso
  // contrário só a viewport 3D ficaria, e o usuário perderia os
  // controles. A Fullscreen API só funciona em resposta a interação
  // direta (gesture user) — clicar no botão satisfaz isso.
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      document.exitFullscreen().catch(() => {
        // Esc nativo do browser pode ter saído antes — ignorar.
      })
    } else {
      el.requestFullscreen().catch(() => {
        // iOS Safari (até v16.3) só implementa em <video>. Em desktop
        // raramente falha; quando falhar (ex: permissão negada), a
        // UX é o botão "não funcionar" — sem toast porque não há
        // como o usuário corrigir e seria barulho.
      })
    }
  }, [])

  // Mantém isFullscreen em sincronia com o estado real do browser.
  // Necessário porque o usuário pode sair via Esc (sem clicar no botão).
  useEffect(() => {
    function handleChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', handleChange)
    return () => document.removeEventListener('fullscreenchange', handleChange)
  }, [])

  // Atalhos de teclado: F/W/R quando o viewer tem foco. Ignorar
  // modificadores (Ctrl/Meta/Alt) — Ctrl+F é busca do browser, Alt+W
  // pode ser atalho de janela. preventDefault evita comportamento
  // padrão (rolagem com espaço, etc).
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key.toLowerCase()
      switch (key) {
        case 'f':
          e.preventDefault()
          toggleFullscreen()
          break
        case 'w':
          e.preventDefault()
          toggleWireframe()
          break
        case 'r':
          e.preventDefault()
          resetCamera()
          break
      }
    },
    [toggleFullscreen, toggleWireframe, resetCamera],
  )

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      // Em fullscreen o container vira preto cobrindo tudo — sem isso,
      // o aspect-square original deixaria letterboxes desproporcionais
      // em monitores wide. bg-twilight harmoniza com a app caso o
      // fundo apareça em ratios estranhos.
      className={`
        relative outline-none
        focus-visible:ring-4 focus-visible:ring-arcane focus-visible:ring-inset
        ${isFullscreen ? 'bg-twilight !aspect-auto w-screen h-screen' : ''}
        ${className ?? ''}
      `}
    >
      <Canvas
        shadows
        camera={{ position: [3, 3, 3], fov: 50 }}
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: false, antialias: true }}
      >
        <ambientLight intensity={0.3} />
        <directionalLight
          position={[5, 5, 5]}
          intensity={0.8}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-near={0.1}
          shadow-camera-far={20}
          shadow-camera-left={-3}
          shadow-camera-right={3}
          shadow-camera-top={3}
          shadow-camera-bottom={-3}
          shadow-bias={-0.0001}
        />
        <Environment preset="city" />

        <Suspense key={modelUrl} fallback={<Loader />}>
          <Model url={modelUrl} wireframe={isWireframe} />
        </Suspense>

        <ContactShadows
          position={[0, 0, 0]}
          opacity={0.5}
          scale={8}
          blur={2.5}
          far={4}
          resolution={512}
        />

        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.1}
          makeDefault
        />
      </Canvas>

      {/* Overlay de controles no canto superior direito.
          - pointer-events-none no container: clicks no espaço entre
            os botões "atravessam" pro Canvas, então o usuário pode
            arrastar o modelo mesmo perto do overlay.
          - pointer-events-auto nos botões: só eles capturam clicks. */}
      <div className="absolute top-3 right-3 flex flex-col gap-2 pointer-events-none">
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
          title="Fullscreen (F)"
          className={`${OVERLAY_BTN} ${
            isFullscreen
              ? 'bg-ink text-parchment'
              : 'bg-parchment text-ink'
          }`}
        >
          {isFullscreen ? '✕' : '⛶'} Fullscreen <Kbd>F</Kbd>
        </button>
        <button
          type="button"
          onClick={toggleWireframe}
          aria-pressed={isWireframe}
          title="Wireframe (W)"
          className={`${OVERLAY_BTN} ${
            isWireframe
              ? 'bg-ink text-parchment'
              : 'bg-parchment text-ink'
          }`}
        >
          {isWireframe ? '◼' : '◻'} Wireframe <Kbd>W</Kbd>
        </button>
        <button
          type="button"
          onClick={resetCamera}
          title="Resetar câmera (R)"
          className={`${OVERLAY_BTN} bg-parchment text-ink`}
        >
          ↺ Resetar <Kbd>R</Kbd>
        </button>
      </div>
    </div>
  )
}

// Kbd: badge minimalista com a tecla do atalho. Borda fina em
// currentColor + opacity-70 mantém o badge legível mas subordinado
// ao texto principal. opacity-70 propaga via inheritance pro border.
function Kbd({ children }: { children: string }) {
  return (
    <span className="ml-1 inline-block border border-current px-1 text-[9px] opacity-70">
      {children}
    </span>
  )
}

// Model: carrega o glTF e propaga shadows + wireframe pra todas as
// meshes da cena.
function Model({ url, wireframe }: { url: string; wireframe: boolean }) {
  const { scene } = useGLTF(url)

  // Sombras: roda uma vez por scene carregada (idempotente).
  useLayoutEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
  }, [scene])

  // Wireframe: roda quando o toggle muda OU quando a cena troca
  // (modelo trocado). Cobrir a troca de cena é importante porque o
  // useGLTF cacheia a scene — uma re-renderização com o mesmo URL
  // não dispara o "ativei wireframe enquanto trocava de modelo".
  //
  // CAVEAT: useGLTF cacheia scenes por URL. Mutar material.wireframe
  // aqui afeta TODAS as instâncias do mesmo modelo na app. Pra nosso
  // uso (um viewer por vez no /asset/:id), não é problema. Quando
  // virar grid de thumbnails 3D, precisará clonar o material.
  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as Mesh
      if (mesh.isMesh) {
        applyWireframe(mesh.material, wireframe)
      }
    })
  }, [scene, wireframe])

  return (
    <Center bottom>
      <primitive object={scene} />
    </Center>
  )
}

// applyWireframe lida com material como objeto único OU como array
// (multi-material meshes existem em modelos exportados de Blender
// com mais de um material por face). Recursão simples cobre os
// dois casos.
//
// Nem todo Material tem a propriedade `wireframe` — ShaderMaterial
// customizado ou LineMaterial não têm. Checamos antes de setar pra
// não adicionar prop fantasma.
function applyWireframe(
  material: Material | Material[],
  wireframe: boolean,
) {
  if (Array.isArray(material)) {
    material.forEach((m) => applyWireframe(m, wireframe))
    return
  }
  if ('wireframe' in material) {
    ;(material as Material & { wireframe: boolean }).wireframe = wireframe
  }
}

// Loader: HTML overlay renderizado DENTRO do Canvas via drei <Html>.
// `center` posiciona o DOM no centro da projeção 3D — fica visualmente
// no meio do viewer mesmo durante orbit.
function Loader() {
  return (
    <Html center>
      <div className="bg-ink text-parchment border-4 border-ink shadow-pixel-sm px-4 py-2 text-xs font-bold uppercase tracking-widest whitespace-nowrap">
        ▌ Carregando modelo...
      </div>
    </Html>
  )
}
