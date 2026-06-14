import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  CheckRun,
  CheckRunsState,
  CreatePrInput,
  CreatePrOutput,
  PullRequestRef,
  PrStatus,
  ReviewComment,
  ScmAdapter,
} from './types.js'

const execFile = promisify(execFileCb)

/**
 * Phase 8b: GitHub SCM adapter that shells out to the `gh` CLI. We use
 * `gh` instead of REST/GraphQL directly so we inherit the user's auth
 * flow — same approach as AO. Every method:
 *   - Validates inputs at the boundary (no string interpolation into
 *     shell strings; `execFile` with argv arrays only).
 *   - Returns typed shapes, not raw JSON.
 *   - Wraps errors with `cause` so the caller can surface them.
 *
 * The adapter is stateless. Build one and reuse it across the lifecycle
 * manager.
 */
export class GitHubScmAdapter implements ScmAdapter {
  /**
   * `ghBinary` defaults to `gh` (resolved via PATH). `ghLeadArgs` is
   * prepended to every invocation — used by tests to point at a stub
   * (`{ ghBinary: process.execPath, ghLeadArgs: [scriptPath] }`).
   */
  constructor(
    private readonly opts: { ghBinary?: string; ghLeadArgs?: string[] } = {},
  ) {}

  private async gh(args: string[]): Promise<string> {
    const bin = this.opts.ghBinary ?? 'gh'
    const lead = this.opts.ghLeadArgs ?? []
    try {
      const { stdout } = await execFile(bin, [...lead, ...args], { encoding: 'utf8' })
      return stdout
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`gh ${args[0]} failed: ${msg}`, { cause: err })
    }
  }

  async probe(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.gh(['--version'])
    } catch {
      return { ok: false, reason: '`gh` CLI not found on PATH' }
    }
    try {
      await this.gh(['auth', 'status'])
    } catch {
      return { ok: false, reason: '`gh auth status` failed — run `gh auth login`' }
    }
    return { ok: true }
  }

  async createPr(cfg: CreatePrInput): Promise<CreatePrOutput> {
    const args = [
      'pr',
      'create',
      '--repo',
      cfg.repo,
      '--base',
      cfg.base,
      '--head',
      cfg.branch,
      '--title',
      cfg.title,
      '--body',
      cfg.body,
    ]
    if (cfg.draft) args.push('--draft')
    const stdout = await this.gh(args)
    // gh prints the PR URL on success.
    const url = stdout.trim().split('\n').pop() ?? ''
    const m = url.match(/\/pull\/(\d+)/)
    if (!m) throw new Error(`unable to parse PR number from gh output: ${stdout}`)
    return { number: Number(m[1]), url }
  }

  async getPr(cfg: PullRequestRef): Promise<PrStatus> {
    const stdout = await this.gh([
      'pr',
      'view',
      String(cfg.number),
      '--repo',
      cfg.repo,
      '--json',
      'state,mergeable,headRefOid,reviewDecision,reviews',
    ])
    const data = parseJson<{
      state: string
      mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null
      headRefOid: string
      reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | '' | null
      reviews?: Array<{ author?: { login?: string } | null }>
    }>(stdout)
    const stateMap: Record<string, PrStatus['state']> = {
      OPEN: 'open',
      CLOSED: 'closed',
      MERGED: 'merged',
    }
    return {
      state: stateMap[data.state] ?? 'open',
      headSha: data.headRefOid,
      mergeable:
        data.mergeable === 'MERGEABLE' ? true : data.mergeable === 'CONFLICTING' ? false : null,
      approved: data.reviewDecision === 'APPROVED',
      reviewers: (data.reviews ?? [])
        .map((r) => r.author?.login)
        .filter((u): u is string => typeof u === 'string'),
    }
  }

  async pollChecks(cfg: { repo: string; ref: string }): Promise<CheckRunsState> {
    const stdout = await this.gh([
      'api',
      `repos/${cfg.repo}/commits/${cfg.ref}/check-runs`,
      '--paginate',
      '--jq',
      '{ runs: [.check_runs[] | { name: .name, status: .status, conclusion: .conclusion }] }',
    ])
    const data = parseJson<{ runs: CheckRun[] }>(stdout)
    const runs = data.runs ?? []
    const done = runs.every((r) => r.status === 'completed')
    const allGreen = runs.length === 0 || runs.every((r) => r.conclusion === 'success')
    return { done, allGreen, runs }
  }

  async listReviewComments(cfg: PullRequestRef): Promise<ReviewComment[]> {
    const stdout = await this.gh([
      'api',
      `repos/${cfg.repo}/pulls/${cfg.number}/comments`,
      '--paginate',
    ])
    type RawComment = {
      id: number
      user?: { login?: string } | null
      body?: string
      path?: string | null
      line?: number | null
      created_at?: string
    }
    const data = parseJson<RawComment[]>(stdout)
    return data.map((c) => ({
      id: c.id,
      author: c.user?.login ?? 'unknown',
      body: c.body ?? '',
      path: c.path ?? null,
      line: c.line ?? null,
      createdAt: c.created_at ?? '',
    }))
  }

  async isMergeable(cfg: PullRequestRef): Promise<boolean> {
    const status = await this.getPr(cfg)
    return status.mergeable === true && status.approved && status.state === 'open'
  }
}

function parseJson<T>(stdout: string): T {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error('gh returned empty output where JSON was expected')
  try {
    return JSON.parse(trimmed) as T
  } catch (err) {
    throw new Error(`failed to parse gh JSON: ${trimmed.slice(0, 200)}…`, { cause: err })
  }
}
