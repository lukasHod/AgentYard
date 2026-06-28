import { createRepo } from './repository.js'

export type FeatureStatus = 'idle' | 'running' | 'done' | 'complete' | 'failed' | 'pending' | (string & {})

export interface Feature {
  id: number
  planetId: number
  name: string
  task: string
  description: string | null
  chatName: string | null
  branch: string | null
  worktreePath: string | null
  status: FeatureStatus
  finalSummary: string | null
  error: string | null
  workflowId: number
  createdAt: number
  handoffContext: string | null
  // Phase 15: PR/CI watcher state
  prNumber: number | null
  prUrl: string | null
  prRepo: string | null
  prHeadSha: string | null
  ciState: 'pending' | 'running' | 'success' | 'failed' | null
  reviewState: 'pending' | 'approved' | 'changes_requested' | null
  prMergeable: boolean | null
  lastWatchedAt: number | null
  watchingEnabled: boolean
}

interface FeatureRow {
  id: number
  planet_id: number
  name: string
  task: string
  description: string | null
  chat_name: string | null
  branch: string | null
  worktree_path: string | null
  status: FeatureStatus
  final_summary: string | null
  error: string | null
  workflow_id: number
  created_at: number
  handoff_context: string | null
  pr_number: number | null
  pr_url: string | null
  pr_repo: string | null
  pr_head_sha: string | null
  ci_state: string | null
  review_state: string | null
  pr_mergeable: number | null
  last_watched_at: number | null
  watching_enabled: number
}

function rowToFeature(row: FeatureRow): Feature {
  return {
    id: row.id,
    planetId: row.planet_id,
    name: row.name,
    task: row.task,
    description: row.description,
    chatName: row.chat_name,
    branch: row.branch,
    worktreePath: row.worktree_path,
    status: row.status,
    finalSummary: row.final_summary,
    error: row.error,
    workflowId: row.workflow_id,
    createdAt: row.created_at,
    handoffContext: row.handoff_context,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    prRepo: row.pr_repo,
    prHeadSha: row.pr_head_sha,
    ciState: (row.ci_state as Feature['ciState']) ?? null,
    reviewState: (row.review_state as Feature['reviewState']) ?? null,
    prMergeable: row.pr_mergeable === null ? null : Boolean(row.pr_mergeable),
    lastWatchedAt: row.last_watched_at,
    watchingEnabled: Boolean(row.watching_enabled),
  }
}

const features = createRepo<FeatureRow, Feature>(rowToFeature)

export function listFeatures(planetId: number): Feature[] {
  return features.all(
    'SELECT * FROM features WHERE planet_id = ? ORDER BY created_at DESC',
    planetId,
  )
}

export function getFeature(id: number): Feature | undefined {
  return features.one('SELECT * FROM features WHERE id = ?', id)
}

export function createFeature(opts: {
  planetId: number
  name: string
  task: string
  workflowId?: number
}): Feature {
  const info = features
    .db()
    .prepare(
      'INSERT INTO features (planet_id, name, task, status, created_at, workflow_id) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(opts.planetId, opts.name, opts.task, 'idle', Date.now(), opts.workflowId ?? 0)
  return getFeature(Number(info.lastInsertRowid))!
}

export function deleteFeature(id: number): void {
  features.db().prepare('DELETE FROM features WHERE id = ?').run(id)
}

export function updateFeature(
  id: number,
  patch: Partial<{
    name: string
    task: string
    description: string | null
    chatName: string | null
    branch: string | null
    worktreePath: string | null
    status: FeatureStatus
    finalSummary: string | null
    error: string | null
    handoffContext: string | null
    // Phase 15: PR/CI watcher fields
    prNumber: number | null
    prUrl: string | null
    prRepo: string | null
    prHeadSha: string | null
    ciState: Feature['ciState']
    reviewState: Feature['reviewState']
    prMergeable: boolean | null
    lastWatchedAt: number | null
    watchingEnabled: boolean
  }>,
): Feature | undefined {
  const sets: string[] = []
  const vals: unknown[] = []
  if ('name' in patch) { sets.push('name = ?'); vals.push(patch.name) }
  if ('task' in patch) { sets.push('task = ?'); vals.push(patch.task) }
  if ('description' in patch) { sets.push('description = ?'); vals.push(patch.description) }
  if ('chatName' in patch) { sets.push('chat_name = ?'); vals.push(patch.chatName) }
  if ('branch' in patch) { sets.push('branch = ?'); vals.push(patch.branch) }
  if ('worktreePath' in patch) { sets.push('worktree_path = ?'); vals.push(patch.worktreePath) }
  if ('status' in patch) { sets.push('status = ?'); vals.push(patch.status) }
  if ('finalSummary' in patch) { sets.push('final_summary = ?'); vals.push(patch.finalSummary) }
  if ('error' in patch) { sets.push('error = ?'); vals.push(patch.error) }
  if ('handoffContext' in patch) { sets.push('handoff_context = ?'); vals.push(patch.handoffContext) }
  if ('prNumber' in patch) { sets.push('pr_number = ?'); vals.push(patch.prNumber) }
  if ('prUrl' in patch) { sets.push('pr_url = ?'); vals.push(patch.prUrl) }
  if ('prRepo' in patch) { sets.push('pr_repo = ?'); vals.push(patch.prRepo) }
  if ('prHeadSha' in patch) { sets.push('pr_head_sha = ?'); vals.push(patch.prHeadSha) }
  if ('ciState' in patch) { sets.push('ci_state = ?'); vals.push(patch.ciState) }
  if ('reviewState' in patch) { sets.push('review_state = ?'); vals.push(patch.reviewState) }
  if ('prMergeable' in patch) { sets.push('pr_mergeable = ?'); vals.push(patch.prMergeable === null ? null : patch.prMergeable ? 1 : 0) }
  if ('lastWatchedAt' in patch) { sets.push('last_watched_at = ?'); vals.push(patch.lastWatchedAt) }
  if ('watchingEnabled' in patch) { sets.push('watching_enabled = ?'); vals.push(patch.watchingEnabled ? 1 : 0) }
  if (sets.length === 0) return getFeature(id)
  vals.push(id)
  features.db().prepare(`UPDATE features SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  return getFeature(id)
}

/** List features that have PR/CI watching enabled. */
export function listWatchedFeatures(): Feature[] {
  return features.all('SELECT * FROM features WHERE watching_enabled = 1 AND pr_number IS NOT NULL')
}
