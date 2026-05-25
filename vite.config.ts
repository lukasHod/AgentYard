import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  root: path.resolve(here, 'src/client'),
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
    port: 5173,
    strictPort: false,
    proxy: {
      // Regex-anchored so it matches only /api/<rest> and not e.g.
      // /api.ts (which would collide with src/client/api.ts at the
      // Vite dev root).
      '^/api/': 'http://localhost:4242',
      '/socket.io': {
        target: 'ws://localhost:4242',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
