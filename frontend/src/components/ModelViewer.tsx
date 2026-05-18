import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
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
//   - Wireframe: traverse na cena e seta material.wireframe em cada
//     mesh. Permite inspecionar a retopologia.
//   - Resetar câmera: chama OrbitControls.reset() pra voltar à pose
//     inicial (position=[3,3,3] olhando pra origem).
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
  const controlsRef = useRef<ControlsRef>(null)

  // OrbitControls.reset() restaura a câmera ao "saved state". O drei
  // captura esse state automaticamente na primeira renderização — não
  // precisamos chamar saveState() manualmente.
  function resetCamera() {
    controlsRef.current?.reset()
  }

  return (
    <div className={`relative ${className ?? ''}`}>
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
          onClick={() => setIsWireframe((v) => !v)}
          aria-pressed={isWireframe}
          className={`${OVERLAY_BTN} ${
            isWireframe
              ? 'bg-ink text-parchment'
              : 'bg-parchment text-ink'
          }`}
        >
          {isWireframe ? '◼' : '◻'} Wireframe
        </button>
        <button
          type="button"
          onClick={resetCamera}
          className={`${OVERLAY_BTN} bg-parchment text-ink`}
        >
          ↺ Resetar
        </button>
      </div>
    </div>
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
