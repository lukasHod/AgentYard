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
 * - Verifies `planetPath` is a git repo
 * - Determines the base branch (defaults to current HEAD if not provided)
 * - Creates a branch `agentyard/<featureName>-<featureId>`
 * - Adds a worktree at `<planetPath>/.agentyard/worktrees/<featureId>`
 *
 * Returns the worktree path and branch name.
 */
export async function createFeatureWorktree(opts: {
  planetPath: string
  featureId: number
  featureName: string
  baseBranch?: string
}): Promise<FeatureWorktree> {
  if (!existsSync(opts.planetPath)) {
    throw new Error(`Project path does not exist: ${opts.planetPath}`)
  }
  const git: SimpleGit = simpleGit(opts.planetPath)
  if (!(await git.checkIsRepo())) {
    throw new Error(`Project path is not a git repo: ${opts.planetPath}`)
  }

  const base = opts.baseBranch ?? (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
  const branch = `agentyard/${sanitize(opts.featureName)}-${opts.featureId}`

  const worktreesRoot = path.join(opts.planetPath, '.agentyard', 'worktrees')
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

/**
 * Create a worktree for a handed-off feature by checking out an EXISTING branch.
 * Fetches the branch from origin first if it doesn't exist locally.
 */
export async function createPickupWorktree(opts: {
  planetPath: string
  featureId: number
  branch: string
}): Promise<FeatureWorktree> {
  if (!existsSync(opts.planetPath)) {
    throw new Error(`Project path does not exist: ${opts.planetPath}`)
  }
  const git: SimpleGit = simpleGit(opts.planetPath)
  if (!(await git.checkIsRepo())) {
    throw new Error(`Project path is not a git repo: ${opts.planetPath}`)
  }

  // Ensure the branch exists locally (may only be on origin).
  try {
    await git.raw(['fetch', 'origin', `${opts.branch}:${opts.branch}`])
  } catch {
    // Branch may already exist locally — ignore fetch errors.
  }

  const worktreesRoot = path.join(opts.planetPath, '.agentyard', 'worktrees')
  mkdirSync(worktreesRoot, { recursive: true })
  const wtPath = path.join(worktreesRoot, String(opts.featureId))

  if (existsSync(wtPath)) {
    try {
      await git.raw(['worktree', 'remove', '--force', wtPath])
    } catch {
      // ignore
    }
    if (existsSync(wtPath)) rmSync(wtPath, { recursive: true, force: true })
  }

  // Checkout existing branch (no -b flag).
  await git.raw(['worktree', 'add', wtPath, opts.branch])
  return { path: wtPath, branch: opts.branch }
}

export async function removeFeatureWorktree(planetPath: string, worktreePath: string): Promise<void> {
  if (!existsSync(planetPath)) return
  const git = simpleGit(planetPath)
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
 *  - Path: `<planetPath>/.agentyard/test-worktrees/<testRunId>`
 *  - Branch: `agentyard-test/<testRunId>`
 *  - Caller is expected to remove both worktree AND branch when done
 *    (via removeTestWorktree) since nothing here is meant to survive.
 */
export async function createTestWorktree(opts: {
  planetPath: string
  testRunId: string
  baseBranch?: string
}): Promise<FeatureWorktree> {
  if (!existsSync(opts.planetPath)) {
    throw new Error(`Project path does not exist: ${opts.planetPath}`)
  }
  const git: SimpleGit = simpleGit(opts.planetPath)
  if (!(await git.checkIsRepo())) {
    throw new Error(`Project path is not a git repo: ${opts.planetPath}`)
  }

  const base = opts.baseBranch ?? (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
  const branch = `agentyard-test/${sanitize(opts.testRunId)}`

  const worktreesRoot = path.join(opts.planetPath, '.agentyard', 'test-worktrees')
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
  planetPath: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  if (!existsSync(planetPath)) return
  const git = simpleGit(planetPath)
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
