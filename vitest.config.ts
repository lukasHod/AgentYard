import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/client/**/*.test.{ts,tsx}'],
    globals: false,
    setupFiles: ['src/client/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@core': path.resolve(here, 'src/core'),
      '@client': path.resolve(here, 'src/client'),
    },
  },
})
