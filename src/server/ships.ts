import { existsSync } from 'node:fs'
import { simpleGit } from 'simple-git'
import { createRepo } from './repository.js'

export interface Ship {
  id: number
  name: string
  projectPath: string
  workflowId: number | null
  state: string
  createdAt: number
  /** Set by the read path — true if projectPath exists on disk right now. */
  pathExists: boolean
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
    pathExists: existsSync(row.project_path),
  }
}

const ships = createRepo<ShipRow, Ship>(rowToShip)

export function listShips(): Ship[] {
  return ships.all('SELECT * FROM ships ORDER BY created_at DESC')
}

export function getShip(id: number): Ship | undefined {
  return ships.one('SELECT * FROM ships WHERE id = ?', id)
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

  const info = ships
    .db()
    .prepare(
      'INSERT INTO ships (name, project_path, workflow_id, state, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(opts.name.trim(), opts.projectPath, opts.workflowId ?? null, 'idle', Date.now())
  return getShip(Number(info.lastInsertRowid))!
}

export function deleteShip(id: number): void {
  const db = ships.db()
  db.prepare('DELETE FROM features WHERE ship_id = ?').run(id)
  db.prepare('DELETE FROM ships WHERE id = ?').run(id)
}

export function setShipState(id: number, state: string): void {
  ships.db().prepare('UPDATE ships SET state = ? WHERE id = ?').run(state, id)
}
