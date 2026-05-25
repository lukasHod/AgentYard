import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppContext } from './context.js'

const execFileP = promisify(execFile)

/** Curated CLIs that drones could plausibly call via Bash. */
const CLI_PROBES: Array<{ name: string; args: string[] }> = [
  { name: 'git', args: ['--version'] },
  { name: 'gh', args: ['--version'] },
  { name: 'node', args: ['--version'] },
  { name: 'npm', args: ['--version'] },
  { name: 'pnpm', args: ['--version'] },
  { name: 'python', args: ['--version'] },
  { name: 'docker', args: ['--version'] },
  { name: 'claude', args: ['--version'] },
]

export function registerHealthRoutes({ app }: AppContext): void {
  app.get('/api/health', async () => ({ ok: true, version: '0.0.1' }))

  app.get('/api/clis', async () => {
    const results = await Promise.all(
      CLI_PROBES.map(async (probe) => {
        try {
          const { stdout, stderr } = await execFileP(probe.name, probe.args, {
            timeout: 3000,
            windowsHide: true,
          })
          const out = (stdout || stderr || '').split(/\r?\n/)[0]?.trim() ?? ''
          return { name: probe.name, available: true, version: out }
        } catch {
          return { name: probe.name, available: false, version: null }
        }
      }),
    )
    return results
  })
}
