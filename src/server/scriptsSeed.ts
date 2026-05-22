import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import type { ScriptTool } from '../core/tools.js'

const SEED_SCRIPTS: ScriptTool[] = [
  {
    name: 'print-task',
    description:
      'Demo script — echoes a message to stdout. Wire {message} to {task} or {upstream_outputs} in the workflow to see node data flow through.',
    cmd: 'echo {message}',
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
 * Write seed scripts to ~/.agentyard/scripts/<name>/manifest.yaml if not already
 * present. Per-ship overrides are unaffected.
 */
export function seedDefaultScriptsIfMissing(): { wrote: string[] } {
  const baseDir = path.join(homedir(), '.agentyard', 'scripts')
  mkdirSync(baseDir, { recursive: true })
  const wrote: string[] = []
  for (const s of SEED_SCRIPTS) {
    const folder = path.join(baseDir, s.name)
    const manifestPath = path.join(folder, 'manifest.yaml')
    if (existsSync(manifestPath)) continue
    mkdirSync(folder, { recursive: true })
    const manifest: Record<string, unknown> = {
      name: s.name,
      description: s.description,
      cmd: s.cmd,
      args: s.args,
    }
    writeFileSync(manifestPath, yaml.dump(manifest, { lineWidth: 0 }), 'utf8')
    wrote.push(s.name)
  }
  return { wrote }
}
