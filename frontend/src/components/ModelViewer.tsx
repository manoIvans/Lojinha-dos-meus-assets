import { Suspense, useLayoutEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  Center,
  ContactShadows,
  Environment,
  Html,
  OrbitControls,
  useGLTF,
} from '@react-three/drei'
import type { Mesh } from 'three'

// ModelViewer: container 3D pronto pra absorver desde PBR realista até
// low-poly stylizado, sem "lavar" a cena.
//
// Estratégia de iluminação:
//   1. Environment (HDRI 'city'): provê IBL — reflexos em metais e
//      brilho difuso ambiente que materiais PBR esperam. Para low-poly
//      com material plano, o impacto é menor mas inofensivo.
//   2. ambientLight 0.3: pequeno fill pra que mesmo materiais que
//      ignoram environment (ex: MeshBasicMaterial) não saiam pretos
//      em sombras totais.
//   3. directionalLight 0.8 com castShadow: a "key light" que define o
//      ângulo principal da iluminação e projeta sombras nítidas.
//   4. ContactShadows: sombra "soft" colada no chão, dá ancoragem
//      visual + senso de escala sem precisar de plano de chão.
//
// Geometria importante: usamos <Center bottom> em vez de <Center>
// para alinhar a BASE do modelo a y=0. Sem isso, modelos exportados
// com pivot arbitrário ficariam meio-enterrados no chão de sombra.
type Props = {
  // URL completa do arquivo .glb/.gltf — geralmente vem de fileUrl()
  // do client (ex: http://localhost:8080/uploads/models/<uuid>.glb).
  modelUrl: string
  // className permite ao consumidor controlar tamanho/aspecto do
  // container. Sem default — Canvas com altura 0 some, então quem
  // usa precisa ser explícito.
  className?: string
}

export default function ModelViewer({ modelUrl, className }: Props) {
  return (
    <div className={className}>
      <Canvas
        // shadows={true} habilita o pipeline de shadow map do three.
        // Sem isso, castShadow/receiveShadow nos elementos é ignorado.
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
          // Resolução do shadow map. 1024 dá sombras razoáveis sem
          // pesar muito; sobe pra 2048 se notar serrilhado evidente.
          shadow-mapSize={[1024, 1024]}
          // Frustum do shadow camera = área coberta pelo shadow map.
          // Generoso o bastante (~3 unidades em cada direção) pra
          // cobrir modelos pequenos a médios; modelos grandes podem
          // ter sombra clipada nas bordas.
          shadow-camera-near={0.1}
          shadow-camera-far={20}
          shadow-camera-left={-3}
          shadow-camera-right={3}
          shadow-camera-top={3}
          shadow-camera-bottom={-3}
          // shadow-bias previne "shadow acne" (padrão moiré em
          // superfícies sombreadas devido a imprecisão de float).
          // Negativo empurra a sombra um pouquinho pra longe da face.
          shadow-bias={-0.0001}
        />

        {/* HDRI 'city' — neutro/diurno, bom default pra exibir tanto
            materiais realistas quanto stylizados. Drei baixa sob
            demanda (~100KB) da CDN; não impacta bundle. Sem prop
            `background`, o HDRI só atua como IBL (não vira skybox). */}
        <Environment preset="city" />

        {/* Suspense pega a Promise lançada por useGLTF enquanto baixa
            o arquivo. key={modelUrl} força re-suspensão ao trocar de
            modelo (sem isso, o fallback só aparece no primeiro load). */}
        <Suspense key={modelUrl} fallback={<Loader />}>
          <Model url={modelUrl} />
        </Suspense>

        {/* ContactShadows projeta a silhueta do modelo num plano
            invisível em y=0. position=[0,0,0] colado ao chão (base
            do modelo, dada a <Center bottom>). Blur alto deixa a
            sombra "soft" — não imita sombra direcional, é uma
            "ambient occlusion fake" que ancora o modelo na cena. */}
        <ContactShadows
          position={[0, 0, 0]}
          opacity={0.5}
          scale={8}
          blur={2.5}
          far={4}
          resolution={512}
        />

        <OrbitControls enableDamping dampingFactor={0.1} makeDefault />
      </Canvas>
    </div>
  )
}

// Model: carrega o glTF e prepara cada mesh interno pra participar do
// shadow map. useGLTF cacheia por URL (instantâneo no segundo load).
function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url)

  // useLayoutEffect (não useEffect) pra rodar ANTES do primeiro paint
  // — evita um frame onde o modelo aparece sem sombras. Idempotente:
  // se a mesma cena for renderizada várias vezes, setar a flag de novo
  // não causa efeito colateral.
  useLayoutEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as Mesh
      if (mesh.isMesh) {
        // castShadow: este objeto gera sombra projetada pela
        // directionalLight. receiveShadow: este objeto pode ter
        // sombras (de si mesmo ou de outros) renderizadas na sua
        // superfície. Ambos no modelo dão auto-sombreamento — ex:
        // braço projeta sombra no peito.
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
  }, [scene])

  // <Center bottom>: alinha a base do bounding box ao y=0 do mundo.
  // Combinação chave com ContactShadows em y=0 — modelo fica "em pé
  // no chão" independente de onde o exportador colocou o pivot.
  return (
    <Center bottom>
      <primitive object={scene} />
    </Center>
  )
}

// Loader: HTML overlay renderizado DENTRO do Canvas via drei <Html>.
// `center` posiciona o DOM no centro da projeção 3D, então a mensagem
// fica visualmente no meio do viewer mesmo durante orbit.
function Loader() {
  return (
    <Html center>
      <div className="bg-ink text-parchment border-4 border-ink shadow-pixel-sm px-4 py-2 text-xs font-bold uppercase tracking-widest whitespace-nowrap">
        ▌ Carregando modelo...
      </div>
    </Html>
  )
}
