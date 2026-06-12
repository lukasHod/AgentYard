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
  workflowId: number
}): Feature {
  const info = features
    .db()
    .prepare(
      'INSERT INTO features (planet_id, name, task, status, created_at, workflow_id) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(opts.planetId, opts.name, opts.task, 'idle', Date.now(), opts.workflowId)
  return getFeature(Number(info.lastInsertRowid))!
}

export function updateFeature(
  id: number,
  patch: Partial<{
    description: string | null
    chatName: string | null
    branch: string | null
    worktreePath: string | null
    status: FeatureStatus
    finalSummary: string | null
    error: string | null
    handoffContext: string | null
  }>,
): Feature | undefined {
  const sets: string[] = []
  const vals: unknown[] = []
  if ('description' in patch) {
    sets.push('description = ?')
    vals.push(patch.description)
  }
  if ('chatName' in patch) {
    sets.push('chat_name = ?')
    vals.push(patch.chatName)
  }
  if ('branch' in patch) {
    sets.push('branch = ?')
    vals.push(patch.branch)
  }
  if ('worktreePath' in patch) {
    sets.push('worktree_path = ?')
    vals.push(patch.worktreePath)
  }
  if ('status' in patch) {
    sets.push('status = ?')
    vals.push(patch.status)
  }
  if ('finalSummary' in patch) {
    sets.push('final_summary = ?')
    vals.push(patch.finalSummary)
  }
  if ('error' in patch) {
    sets.push('error = ?')
    vals.push(patch.error)
  }
  if ('handoffContext' in patch) {
    sets.push('handoff_context = ?')
    vals.push(patch.handoffContext)
  }
  if (sets.length === 0) return getFeature(id)
  vals.push(id)
  features.db().prepare(`UPDATE features SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  return getFeature(id)
}
