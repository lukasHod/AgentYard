import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPort = Number(process.env.AGENTYARD_CLIENT_PORT ?? 5173)
const serverPort = Number(process.env.AGENTYARD_SERVER_PORT ?? 4242)
const serverHttpTarget = `http://localhost:${serverPort}`
const serverWsTarget = `ws://localhost:${serverPort}`

export default defineConfig({
  plugins: [react()],
  root: path.resolve(here, 'src/client'),
  // Static assets (GLB models, textures) live at the repo-root /public.
  // Point vite there so dev serves them alongside the proxied /api routes.
  publicDir: path.resolve(here, 'public'),
  build: {
    outDir: path.resolve(here, 'dist/public'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@core': path.resolve(here, 'src/core'),
      '@client': path.resolve(here, 'src/client'),
    },
  },
  server: {
    port: clientPort,
    strictPort: process.env.AGENTYARD_CLIENT_PORT !== undefined,
    proxy: {
      // Regex-anchored so it matches only /api/<rest> and not e.g.
      // /api.ts (which would collide with src/client/api.ts at the
      // Vite dev root).
      '^/api/': serverHttpTarget,
      '/socket.io': {
        target: serverWsTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
