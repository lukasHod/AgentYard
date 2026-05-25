import { getDb } from './db.js'

export type FeatureStatus = 'pending' | 'running' | 'complete' | 'failed'

export interface Feature {
  id: number
  shipId: number
  name: string
  task: string
  branch: string | null
  worktreePath: string | null
  status: FeatureStatus
  finalSummary: string | null
  error: string | null
  workflowId: number
  createdAt: number
}

interface FeatureRow {
  id: number
  ship_id: number
  name: string
  task: string
  branch: string | null
  worktree_path: string | null
  status: FeatureStatus
  final_summary: string | null
  error: string | null
  workflow_id: number
  created_at: number
}

function rowToFeature(row: FeatureRow): Feature {
  return {
    id: row.id,
    shipId: row.ship_id,
    name: row.name,
    task: row.task,
    branch: row.branch,
    worktreePath: row.worktree_path,
    status: row.status,
    finalSummary: row.final_summary,
    error: row.error,
    workflowId: row.workflow_id,
    createdAt: row.created_at,
  }
}

export function listFeatures(shipId: number): Feature[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM features WHERE ship_id = ? ORDER BY created_at DESC')
    .all(shipId) as FeatureRow[]
  return rows.map(rowToFeature)
}

export function getFeature(id: number): Feature | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM features WHERE id = ?').get(id) as FeatureRow | undefined
  return row ? rowToFeature(row) : undefined
}

export function createFeature(opts: {
  shipId: number
  name: string
  task: string
  workflowId: number
}): Feature {
  const db = getDb()
  const info = db
    .prepare(
      'INSERT INTO features (ship_id, name, task, status, created_at, workflow_id) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(opts.shipId, opts.name, opts.task, 'pending', Date.now(), opts.workflowId)
  return getFeature(Number(info.lastInsertRowid))!
}

export function updateFeature(
  id: number,
  patch: Partial<{
    branch: string | null
    worktreePath: string | null
    status: FeatureStatus
    finalSummary: string | null
    error: string | null
  }>,
): Feature | undefined {
  const db = getDb()
  const sets: string[] = []
  const vals: unknown[] = []
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
  if (sets.length === 0) return getFeature(id)
  vals.push(id)
  db.prepare(`UPDATE features SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  return getFeature(id)
}
