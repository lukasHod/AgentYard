import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'

export interface FeatureWorktree {
  path: string
  branch: string
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60)
}

/**
 * Create a new git worktree for a feature run.
 *
 * - Verifies `shipPath` is a git repo
 * - Determines the base branch (defaults to current HEAD if not provided)
 * - Creates a branch `agentyard/<featureName>-<featureId>`
 * - Adds a worktree at `<shipPath>/.agentyard/worktrees/<featureId>`
 *
 * Returns the worktree path and branch name.
 */
export async function createFeatureWorktree(opts: {
  shipPath: string
  featureId: number
  featureName: string
  baseBranch?: string
}): Promise<FeatureWorktree> {
  if (!existsSync(opts.shipPath)) {
    throw new Error(`Ship path does not exist: ${opts.shipPath}`)
  }
  const git: SimpleGit = simpleGit(opts.shipPath)
  if (!(await git.checkIsRepo())) {
    throw new Error(`Ship path is not a git repo: ${opts.shipPath}`)
  }

  const base = opts.baseBranch ?? (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
  const branch = `agentyard/${sanitize(opts.featureName)}-${opts.featureId}`

  const worktreesRoot = path.join(opts.shipPath, '.agentyard', 'worktrees')
  mkdirSync(worktreesRoot, { recursive: true })
  const wtPath = path.join(worktreesRoot, String(opts.featureId))

  if (existsSync(wtPath)) {
    // Could be an orphaned worktree from a prior crash; clean up first.
    try {
      await git.raw(['worktree', 'remove', '--force', wtPath])
    } catch {
      // ignore — fall back to manual rm
    }
    if (existsSync(wtPath)) rmSync(wtPath, { recursive: true, force: true })
  }

  await git.raw(['worktree', 'add', '-b', branch, wtPath, base])
  return { path: wtPath, branch }
}

export async function removeFeatureWorktree(shipPath: string, worktreePath: string): Promise<void> {
  if (!existsSync(shipPath)) return
  const git = simpleGit(shipPath)
  try {
    await git.raw(['worktree', 'remove', '--force', worktreePath])
  } catch {
    // best effort
  }
  if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true })
}

/**
 * Create a disposable worktree for a sandbox test run.
 *
 * Mirrors createFeatureWorktree but:
 *  - Path: `<shipPath>/.agentyard/test-worktrees/<testRunId>`
 *  - Branch: `agentyard-test/<testRunId>`
 *  - Caller is expected to remove both worktree AND branch when done
 *    (via removeTestWorktree) since nothing here is meant to survive.
 */
export async function createTestWorktree(opts: {
  shipPath: string
  testRunId: string
  baseBranch?: string
}): Promise<FeatureWorktree> {
  if (!existsSync(opts.shipPath)) {
    throw new Error(`Ship path does not exist: ${opts.shipPath}`)
  }
  const git: SimpleGit = simpleGit(opts.shipPath)
  if (!(await git.checkIsRepo())) {
    throw new Error(`Ship path is not a git repo: ${opts.shipPath}`)
  }

  const base = opts.baseBranch ?? (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
  const branch = `agentyard-test/${sanitize(opts.testRunId)}`

  const worktreesRoot = path.join(opts.shipPath, '.agentyard', 'test-worktrees')
  mkdirSync(worktreesRoot, { recursive: true })
  const wtPath = path.join(worktreesRoot, opts.testRunId)

  if (existsSync(wtPath)) {
    try {
      await git.raw(['worktree', 'remove', '--force', wtPath])
    } catch {
      // ignore
    }
    if (existsSync(wtPath)) rmSync(wtPath, { recursive: true, force: true })
  }

  await git.raw(['worktree', 'add', '-b', branch, wtPath, base])
  return { path: wtPath, branch }
}

/**
 * Tear down a test worktree AND delete its branch.
 * Best-effort — never throws.
 */
export async function removeTestWorktree(
  shipPath: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  if (!existsSync(shipPath)) return
  const git = simpleGit(shipPath)
  try {
    await git.raw(['worktree', 'remove', '--force', worktreePath])
  } catch {
    // best effort
  }
  if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true })
  try {
    await git.raw(['branch', '-D', branch])
  } catch {
    // best effort — branch may already be gone
  }
}
