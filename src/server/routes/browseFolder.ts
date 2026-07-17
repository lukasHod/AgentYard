import { readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { listPlanets } from '../planets.js'
import type { AppContext } from './context.js'

function listDirs(dirPath: string): { name: string; path: string }[] {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => {
        if (!e.isDirectory()) return false
        // Skip hidden dirs and common noise
        if (e.name.startsWith('.')) return false
        if (e.name === 'node_modules') return false
        return true
      })
      .map((e) => ({ name: e.name, path: path.join(dirPath, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Resolve a path through symlinks when possible, else normalize it. */
function canonical(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/**
 * Directories the folder picker is allowed to enumerate:
 *   - the user's home directory
 *   - every existing planet's project path (so previously-added projects stay browsable)
 *   - any roots listed in AGENTYARD_BROWSE_ROOTS (path-delimiter separated)
 *
 * This bounds an otherwise unauthenticated filesystem-enumeration surface to
 * paths the user has already opted into, instead of the entire filesystem.
 */
function allowedRoots(): string[] {
  const roots = new Set<string>([canonical(homedir())])
  for (const planet of listPlanets()) {
    if (planet.projectPath) roots.add(canonical(planet.projectPath))
  }
  const extra = process.env.AGENTYARD_BROWSE_ROOTS
  if (extra) {
    for (const r of extra.split(path.delimiter)) {
      const trimmed = r.trim()
      if (trimmed) roots.add(canonical(trimmed))
    }
  }
  return [...roots]
}

/** True if `target` is one of, or nested under, an allowed root. */
function isAllowed(target: string, roots: string[]): boolean {
  const t = canonical(target)
  return roots.some((root) => {
    if (t === root) return true
    const rel = path.relative(root, t)
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
  })
}

let cachedWindowsRoots: { name: string; path: string }[] | null = null

function windowsRoots(): { name: string; path: string }[] {
  if (cachedWindowsRoots) return cachedWindowsRoots

  cachedWindowsRoots = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    .split('')
    .map((letter) => `${letter}:\\`)
    .filter(isDir)
    .map((drive) => ({ name: drive, path: drive }))

  return cachedWindowsRoots
}

/** Filesystem roots for quick navigation. Cache drive detection so folder clicks stay fast. */
export function rootsFor(current: string): { name: string; path: string }[] {
  if (process.platform === 'win32') {
    return windowsRoots()
  }
  return [{ name: '/', path: '/' }]
}

export function registerBrowseFolderRoute({ app }: AppContext): void {
  /**
   * List subdirectories at `?path=<dir>` (or home dir if omitted).
   * The requested path must be inside an allowed root (see allowedRoots);
   * anything else falls back to the home directory. Returns:
   *   { current, parent, entries: [{name, path}], roots }
   */
  app.get<{ Querystring: { path?: string } }>('/api/fs/dirs', async (req) => {
    const roots = allowedRoots()
    const reqPath = req.query.path?.trim()
    const current =
      reqPath && isDir(reqPath) && isAllowed(reqPath, roots) ? reqPath : homedir()
    const parentPath = path.dirname(current)
    // Only offer the parent link when it stays inside an allowed root.
    const parent =
      parentPath !== current && isAllowed(parentPath, roots) ? parentPath : null
    return {
      current,
      parent,
      entries: listDirs(current),
      roots: rootsFor(current),
    }
  })
}
