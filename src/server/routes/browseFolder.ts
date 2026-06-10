import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
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
   * Returns: { current, parent, entries: [{name, path}] }
   */
  app.get<{ Querystring: { path?: string } }>('/api/fs/dirs', async (req) => {
    const reqPath = req.query.path?.trim()
    const current = reqPath && isDir(reqPath) ? reqPath : homedir()
    const parentPath = path.dirname(current)
    const parent = parentPath !== current ? parentPath : null
    return {
      current,
      parent,
      entries: listDirs(current),
      roots: rootsFor(current),
    }
  })
}
