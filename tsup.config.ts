import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/server/cli.ts',
  },
  format: ['esm'],
  outDir: 'dist/server',
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  splitting: false,
  banner: { js: '#!/usr/bin/env node' },
  // Keep all dependencies external so native modules (better-sqlite3) and
  // peer-installed packages resolve at the consumer's node_modules.
  external: [/^[^./]/],
})
