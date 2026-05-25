import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import type { ScriptTool } from '../core/tools.js'

/**
 * Seed scripts. `cmd` is whitespace-tokenized by the runner (NO shell), so
 * each token here becomes one argv element. Values like {message} that contain
 * spaces or shell metacharacters stay inside their argv slot — they cannot
 * inject extra arguments or invoke other programs.
 *
 * We use `node -e` for the demo script because `echo` is a cmd.exe built-in
 * on Windows (no real binary). Node is required by the server anyway, so it's
 * the only program guaranteed to exist on every supported platform.
 */
const SEED_SCRIPTS: ScriptTool[] = [
  {
    name: 'print-task',
    description:
      'Demo script — echoes a message to stdout. Wire {message} to {task} or {upstream_outputs} in the workflow to see node data flow through.',
    cmd: 'node -e console.log(process.argv[1]) {message}',
    args: [
      {
        name: 'message',
        description:
          'Text to print. In a workflow node, set this to e.g. "Task received: {task}".',
        required: true,
      },
    ],
  },
]

/**
 * Detect the pre-PR1 seed (shell-string `cmd: echo {message}`) on disk so we
 * can auto-migrate it to the new argv-safe form. Anything else — including
 * user customizations — is left alone.
 */
function looksLikeLegacyPrintTask(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== 'object') return false
  const m = manifest as Record<string, unknown>
  return m.name === 'print-task' && m.cmd === 'echo {message}'
}

function writeManifest(manifestPath: string, s: ScriptTool): void {
  const manifest: Record<string, unknown> = {
    name: s.name,
    description: s.description,
    cmd: s.cmd,
    args: s.args,
  }
  writeFileSync(manifestPath, yaml.dump(manifest, { lineWidth: 0 }), 'utf8')
}

/**
 * Write seed scripts to ~/.agentyard/scripts/<name>/manifest.yaml if not already
 * present. Also auto-migrates the legacy `print-task` seed (which used a
 * shell-interpreted cmd) to the new argv-safe form. Per-ship overrides are
 * unaffected.
 */
export function seedDefaultScriptsIfMissing(): { wrote: string[]; migrated: string[] } {
  const baseDir = path.join(homedir(), '.agentyard', 'scripts')
  mkdirSync(baseDir, { recursive: true })
  const wrote: string[] = []
  const migrated: string[] = []
  for (const s of SEED_SCRIPTS) {
    const folder = path.join(baseDir, s.name)
    const manifestPath = path.join(folder, 'manifest.yaml')
    if (existsSync(manifestPath)) {
      try {
        const parsed = yaml.load(readFileSync(manifestPath, 'utf8'))
        if (looksLikeLegacyPrintTask(parsed)) {
          writeManifest(manifestPath, s)
          migrated.push(s.name)
        }
      } catch {
        // Corrupt manifest — leave it alone; the user will see the error at scan time.
      }
      continue
    }
    mkdirSync(folder, { recursive: true })
    writeManifest(manifestPath, s)
    wrote.push(s.name)
  }
  return { wrote, migrated }
}
