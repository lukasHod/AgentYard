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

interface PlanetRow {
  id: number
  name: string
  project_path: string
  workflow_id: number | null
  state: string
  created_at: number
}

function rowToPlanet(row: PlanetRow): Ship {
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

const planets = createRepo<PlanetRow, Ship>(rowToPlanet)

export function listPlanets(): Ship[] {
  return planets.all('SELECT * FROM planets ORDER BY created_at DESC')
}

export function getPlanet(id: number): Ship | undefined {
  return planets.one('SELECT * FROM planets WHERE id = ?', id)
}

export async function createPlanet(opts: {
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

  const info = planets
    .db()
    .prepare(
      'INSERT INTO planets (name, project_path, workflow_id, state, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(opts.name.trim(), opts.projectPath, opts.workflowId ?? null, 'idle', Date.now())
  return getPlanet(Number(info.lastInsertRowid))!
}

export function deletePlanet(id: number): void {
  const db = planets.db()
  db.prepare('DELETE FROM features WHERE planet_id = ?').run(id)
  db.prepare('DELETE FROM planets WHERE id = ?').run(id)
}

export function setPlanetState(id: number, state: string): void {
  planets.db().prepare('UPDATE planets SET state = ? WHERE id = ?').run(state, id)
}
