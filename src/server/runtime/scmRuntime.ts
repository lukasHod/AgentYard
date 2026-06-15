import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import type { NodeRunInput, NodeRunResult } from '../../core/executor.js'
import { updateFeature } from '../features.js'
import { prWatcherGateRegistry, type PrGateKind } from '../prWatcherGateRegistry.js'
import type { ScmAdapter } from '../scm/types.js'
import type { TypedIOServer } from '../socketTypes.js'

const execFile = promisify(execFileCb)

const PR_GATE_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 hours

/**
 * Run an `open-pr` custom node.
 *
 * Detects the GitHub repo from the worktree, creates a PR via `ScmAdapter`,
 * persists PR metadata on the feature, and enables watching so the background
 * `PrWatcher` starts polling immediately.
 */
export async function runOpenPrNode(
  input: NodeRunInput,
  featureId: number | null | undefined,
  scm: ScmAdapter | undefined,
  io: TypedIOServer | undefined,
): Promise<NodeRunResult> {
  if (!scm) throw new Error('open-pr node requires a ScmAdapter — is GitHub configured?')
  if (!featureId) throw new Error('open-pr node requires a featureId')

  const cwd = input.cwd
  if (!cwd) throw new Error('open-pr node requires a working directory (worktree path)')

  const node = input.node
  const base = node.prBase ?? 'main'

  // Detect the branch and repo from the worktree.
  const [branchOut, repoOut] = await Promise.all([
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' }),
    execFile('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
      cwd,
      encoding: 'utf8',
    }),
  ]).catch((err) => {
    throw new Error(
      `open-pr: failed to detect branch/repo — is git and gh available? ${err instanceof Error ? err.message : String(err)}`,
    )
  })

  const branch = branchOut.stdout.trim()
  const repo = repoOut.stdout.trim()

  if (!branch || branch === 'HEAD') {
    throw new Error('open-pr: worktree is in detached HEAD state — commit and check out a branch first')
  }

  // Push the branch to remote before creating the PR.
  try {
    await execFile('git', ['push', '--set-upstream', 'origin', branch], { cwd, encoding: 'utf8' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`open-pr: failed to push branch ${branch}: ${msg}`)
  }

  // Get the current HEAD SHA.
  const shaOut = await execFile('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })
  const headSha = shaOut.stdout.trim()

  // Build PR title and body from the workflow context.
  const prTitle = input.task.split('\n')[0]?.slice(0, 100) ?? input.task
  const prBody = input.upstreamOutputs || input.task

  const prOut = await scm.createPr({ repo, branch, base, title: prTitle, body: prBody })

  // Persist PR metadata and enable watching.
  const updated = updateFeature(featureId, {
    prNumber: prOut.number,
    prUrl: prOut.url,
    prRepo: repo,
    prHeadSha: headSha,
    ciState: 'pending',
    reviewState: 'pending',
    watchingEnabled: true,
  })
  if (updated && io) io.emit('feature:updated', updated)

  return {
    summary: `PR #${prOut.number} opened: ${prOut.url}\nBranch: ${branch} → ${base}`,
    outputs: { prNumber: String(prOut.number), prUrl: prOut.url, repo, branch },
  }
}

/**
 * Run a `pr-gate` custom node.
 *
 * Registers a gate in `prWatcherGateRegistry` and awaits resolution by the
 * background `PrWatcher`. The workflow executor pauses here until CI passes
 * (kind='ci') or the PR is approved (kind='review').
 */
export async function runPrGateNode(
  input: NodeRunInput,
  featureId: number | null | undefined,
  signal: AbortSignal | undefined,
): Promise<NodeRunResult> {
  if (!featureId) throw new Error('pr-gate node requires a featureId')

  const kind = (input.node.prGateKind ?? 'ci') as PrGateKind

  return new Promise<NodeRunResult>((resolve, reject) => {
    const unregister = prWatcherGateRegistry.register(
      featureId,
      kind,
      (summary) => {
        unregister()
        signal?.removeEventListener('abort', onAbort)
        resolve({ summary })
      },
      (err) => {
        unregister()
        signal?.removeEventListener('abort', onAbort)
        reject(err)
      },
      PR_GATE_TIMEOUT_MS,
    )

    const onAbort = () => {
      unregister()
      prWatcherGateRegistry.fail(featureId, kind, new Error('run aborted'))
      reject(new Error('run aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
