import { existsSync } from 'node:fs'
import { simpleGit } from 'simple-git'
import { getDb } from './db.js'

export interface Ship {
  id: number
  name: string
  projectPath: string
  workflowId: number | null
  state: string
  createdAt: number
}

interface ShipRow {
  id: number
  name: string
  project_path: string
  workflow_id: number | null
  state: string
  created_at: number
}

function rowToShip(row: ShipRow): Ship {
  return {
    id: row.id,
    name: row.name,
    projectPath: row.project_path,
    workflowId: row.workflow_id,
    state: row.state,
    createdAt: row.created_at,
  }
}

export function listShips(): Ship[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM ships ORDER BY created_at DESC').all() as ShipRow[]
  return rows.map(rowToShip)
}

export function getShip(id: number): Ship | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM ships WHERE id = ?').get(id) as ShipRow | undefined
  return row ? rowToShip(row) : undefined
}

export async function createShip(opts: {
  name: string
  projectPath: string
  workflowId?: number | null
}): Promise<Ship> {
  if (!opts.name?.trim()) throw new Error('name required')
  if (!opts.projectPath?.trim()) throw new Error('project path required')
  if (!existsSync(opts.projectPath)) {
    throw new Error(`Project path does not exist: ${opts.projectPath}`)
  }
  // Sanity: require it's a git repo so worktrees will work later.
  const git = simpleGit(opts.projectPath)
  if (!(await git.checkIsRepo())) {
    throw new Error(`Project path is not a git repository: ${opts.projectPath}`)
  }

  const db = getDb()
  const info = db
    .prepare(
      'INSERT INTO ships (name, project_path, workflow_id, state, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(opts.name.trim(), opts.projectPath, opts.workflowId ?? null, 'idle', Date.now())
  return getShip(Number(info.lastInsertRowid))!
}

export function deleteShip(id: number): void {
  const db = getDb()
  db.prepare('DELETE FROM features WHERE ship_id = ?').run(id)
  db.prepare('DELETE FROM ships WHERE id = ?').run(id)
}

export function setShipState(id: number, state: string): void {
  getDb().prepare('UPDATE ships SET state = ? WHERE id = ?').run(state, id)
}
