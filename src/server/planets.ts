import { existsSync } from 'node:fs'
import { simpleGit } from 'simple-git'
import { createRepo } from './repository.js'

const TEXTURES = [
  'Alpine', 'Gaseous1', 'Gaseous2', 'Gaseous3', 'Gaseous4',
  'Icy', 'Martian', 'Savannah', 'Swamp',
  'Terrestrial1', 'Terrestrial2', 'Terrestrial3', 'Terrestrial4',
  'Tropical', 'Venusian', 'Volcanic',
]

function pickTexture(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0
  return TEXTURES[Math.abs(h) % TEXTURES.length]!
}

export interface Planet {
  id: number
  name: string
  projectPath: string
  workflowId: number | null
  state: string
  createdAt: number
  texture: string | null
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
  texture: string | null
}

function rowToPlanet(row: PlanetRow): Planet {
  return {
    id: row.id,
    name: row.name,
    projectPath: row.project_path,
    workflowId: row.workflow_id,
    state: row.state,
    createdAt: row.created_at,
    texture: row.texture,
    pathExists: existsSync(row.project_path),
  }
}

const planets = createRepo<PlanetRow, Planet>(rowToPlanet)

export function listPlanets(): Planet[] {
  return planets.all('SELECT * FROM planets ORDER BY created_at DESC')
}

export function getPlanet(id: number): Planet | undefined {
  return planets.one('SELECT * FROM planets WHERE id = ?', id)
}

export async function createPlanet(opts: {
  name: string
  projectPath: string
  workflowId?: number | null
}): Promise<Planet> {
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

  const texture = pickTexture(opts.name.trim())
  const info = planets
    .db()
    .prepare(
      'INSERT INTO planets (name, project_path, workflow_id, state, created_at, texture) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(opts.name.trim(), opts.projectPath, opts.workflowId ?? null, 'idle', Date.now(), texture)
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
