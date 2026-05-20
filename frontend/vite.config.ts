import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Vite + React + Tailwind v4. Sem proxy: o frontend bate direto na
// API em http://localhost:8080 e exercita o CORS configurado lá.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  build: {
    // ModelViewer puxa three.js + R3F + drei (~1 MB). Já está em
    // chunk próprio via React.lazy — usuários da galeria/home não
    // baixam. O warning padrão de 500 kB gera ruído sem ganho real;
    // elevamos pra 1100 kB pra continuar protegendo contra chunks
    // INESPERADOS sem alarme falso no caso conhecido.
    chunkSizeWarningLimit: 1100,
    // modulePreload.resolveDependencies: por padrão o Vite injeta
    // <link rel="modulepreload"> pra TODO chunk que o entry depende,
    // incluindo deps transitivas. Como agrupamos three num chunk
    // próprio, ele entra na lista de preload mesmo só sendo usado
    // em rota lazy (/asset/:id, /viewer). Filtramos manualmente —
    // assim usuários da home não baixam 876 kB de three.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((d) => !d.includes('three-')),
    },
    rollupOptions: {
      output: {
        // manualChunks separa as deps pesadas em chunks próprios.
        // Beneficia o cache do navegador: atualizar nosso código
        // não invalida o chunk de react/three.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('three') || id.includes('@react-three')) {
              return 'three'
            }
            if (id.includes('react-router')) {
              return 'router'
            }
            if (id.includes('react') || id.includes('scheduler')) {
              return 'react'
            }
          }
        },
      },
    },
  },
})
