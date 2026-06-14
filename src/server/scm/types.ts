/**
 * SCM adapter slot — Phase 8b. Mirrors the shape AO uses in its
 * `scm-github` plugin so we can swap in `scm-gitlab` later without
 * touching workflow nodes. Every workflow step that needs PR / CI /
 * review state goes through this interface.
 */

export interface PullRequestRef {
  /** The repo in `owner/name` form, e.g. `agentyard/agentyard`. */
  repo: string
  /** PR number. */
  number: number
}

export interface CreatePrInput {
  repo: string
  branch: string
  base: string
  title: string
  body: string
  /** When true, opens as a draft PR. */
  draft?: boolean
}

export interface CreatePrOutput {
  number: number
  url: string
}

export type PrState = 'open' | 'closed' | 'merged'

export interface PrStatus {
  state: PrState
  /** Most recent commit SHA on the PR. */
  headSha: string
  mergeable: boolean | null
  /** True once the PR has at least one approving review and no requested
   *  changes outstanding. */
  approved: boolean
  reviewers: string[]
}

export type CheckConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'neutral'
  | 'skipped'
  | 'action_required'
  | 'startup_failure'
  | null

export interface CheckRun {
  name: string
  status: 'queued' | 'in_progress' | 'completed' | (string & {})
  conclusion: CheckConclusion
}

export interface CheckRunsState {
  /** True when all checks have a conclusion (success or otherwise). */
  done: boolean
  /** True when every conclusion is `success` (or the array is empty). */
  allGreen: boolean
  runs: CheckRun[]
}

export interface ReviewComment {
  id: number
  author: string
  body: string
  path: string | null
  line: number | null
  createdAt: string
}

export interface ScmAdapter {
  /** Probe at boot — returns whether the underlying tooling (gh CLI, auth)
   *  is usable. Non-throwing; callers gate workflow nodes on the result. */
  probe(): Promise<{ ok: true } | { ok: false; reason: string }>
  createPr(cfg: CreatePrInput): Promise<CreatePrOutput>
  getPr(cfg: PullRequestRef): Promise<PrStatus>
  pollChecks(cfg: { repo: string; ref: string }): Promise<CheckRunsState>
  listReviewComments(cfg: PullRequestRef): Promise<ReviewComment[]>
  isMergeable(cfg: PullRequestRef): Promise<boolean>
}
