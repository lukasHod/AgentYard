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

// FNV-1a 32-bit — mirrors src/client/scene/lib/hash.ts so surface type
// derivation is identical on server and client.
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function hashByte(h: number, i: number): number {
  return (h >>> (i * 8)) & 0xff
}

// Surface type order must match src/client/scene/lib/planetParams.ts exactly.
const SURFACES = ['rocky', 'gas', 'lava', 'ice', 'ocean', 'crystal', 'ringed'] as const
type SurfaceType = (typeof SURFACES)[number]

// Maximum hashByte value (0–255) that results in clouds for each surface type.
// hashByte(h2, 1) < threshold → has clouds.
const CLOUD_THRESHOLDS: Record<SurfaceType, number> = {
  ocean:   192, // 75 %
  ice:     153, // 60 %
  rocky:   115, // 45 %
  ringed:   64, // 25 %
  crystal:  51, // 20 %
  lava:     26, // 10 %
  gas:       0, //  0 %
}

export function pickHasClouds(name: string): boolean {
  const h1 = fnv1a(name)
  // h2 uses the same derivation as deriveHash(h1, 'planet') in planetParams.ts
  const h2 = fnv1a('planet' + h1.toString(16))
  const surfaceType = SURFACES[hashByte(h1, 1) % SURFACES.length]!
  const threshold = CLOUD_THRESHOLDS[surfaceType]
  // byte 1 of h2 is independent of hasRing (which uses byte 0 of h2)
  return hashByte(h2, 1) < threshold
}

export interface Planet {
  id: number
  name: string
  projectPath: string
  workflowId: number | null
  state: string
  createdAt: number
  texture: string | null
  hasClouds: boolean
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
  has_clouds: number
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
    hasClouds: row.has_clouds === 1,
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

  const texture   = pickTexture(opts.name.trim())
  const hasClouds = pickHasClouds(opts.name.trim())
  const info = planets
    .db()
    .prepare(
      'INSERT INTO planets (name, project_path, workflow_id, state, created_at, texture, has_clouds) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(opts.name.trim(), opts.projectPath, opts.workflowId ?? null, 'idle', Date.now(), texture, hasClouds ? 1 : 0)
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
