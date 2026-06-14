import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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
  // ── Phase 8a: AO-style workflow scripts ────────────────────────────
  // Placeholder implementations — every node prints a deterministic
  // marker line so the workflow runs end-to-end against an empty repo.
  // Phase 8b swaps the SCM-touching ones (open-pr, watch-ci, watch-review)
  // for real `gh`-backed implementations behind the ScmAdapter interface.
  {
    name: 'ao-create-branch',
    description:
      'Create a feature branch from the current HEAD. Runs inside the feature worktree (the workflow passes the worktree as cwd).',
    cmd: 'git checkout -b {branch}',
    args: [
      { name: 'branch', description: 'Branch name', required: true },
    ],
  },
  {
    name: 'ao-run-tests',
    description:
      'Run the project test suite. Defaults to `npm test`; override the cmd in your planet to run pytest / cargo test / etc.',
    cmd: 'npm test',
    args: [],
  },
  {
    name: 'ao-commit',
    description: 'Stage everything in the worktree and commit with the given message.',
    cmd: 'node -e require(\'node:child_process\').execSync(`git add -A && git commit -m ${JSON.stringify(process.argv[1])}`,{stdio:\'inherit\'}) {message}',
    args: [
      { name: 'message', description: 'Commit message', required: true },
    ],
  },
  {
    name: 'ao-open-pr',
    description:
      'PHASE 8a PLACEHOLDER — writes PR-PENDING.md describing the intended PR. Phase 8b replaces this with `gh pr create` via the ScmAdapter.',
    cmd: 'node -e require(\'node:fs\').writeFileSync(\'PR-PENDING.md\',`Title: ${process.argv[1]}\\n\\n${process.argv[2]}\\n`) {title} {body}',
    args: [
      { name: 'title', description: 'PR title', required: true },
      { name: 'body', description: 'PR body', required: true },
    ],
  },
  {
    name: 'ao-watch-ci',
    description:
      'PHASE 8a PLACEHOLDER — writes CI-OK.md and exits. Phase 8b polls real `gh pr checks`.',
    cmd: 'node -e require(\'node:fs\').writeFileSync(\'CI-OK.md\',\'ok\')',
    args: [],
  },
  {
    name: 'ao-watch-review',
    description:
      'PHASE 8a PLACEHOLDER — writes REVIEW-OK.md and exits. Phase 8b polls real review comments.',
    cmd: 'node -e require(\'node:fs\').writeFileSync(\'REVIEW-OK.md\',\'ok\')',
    args: [],
  },
  {
    name: 'ao-mark-ready',
    description:
      'Print a ready-to-merge marker. The workflow node treats this as the terminal step before manual merge.',
    cmd: 'node -e console.log(`ready-to-merge: ${process.argv[1]}`) {summary}',
    args: [
      { name: 'summary', description: 'One-line summary of the feature', required: true },
    ],
  },
]

/**
 * Write seed scripts to ~/.agentyard/scripts/<name>/manifest.yaml if not already
 * present. Per-planet overrides are unaffected.
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
