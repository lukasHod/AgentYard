import type { ToolEntry, ToolScope, ToolType } from '../../core/tools.js'
import type { PathContext } from './paths.js'

/**
 * In-memory cache for tool scans, keyed by (scope, type, shipProjectPath).
 *
 * Two invalidation mechanisms:
 *   - TTL: entries expire after `DEFAULT_TTL_MS` so direct on-disk edits land
 *     within a few seconds without the user having to restart.
 *   - Explicit: writeTool/deleteTool/adopt/elevate/fork call `invalidate(...)`
 *     so changes routed through our CRUD layer are visible immediately.
 *
 * The TTL is intentionally short (5s) — this is a perf cache, not a snapshot.
 */
interface CacheEntry {
  data: ToolEntry[]
  expiresAt: number
}

const DEFAULT_TTL_MS = 5_000

const cache = new Map<string, CacheEntry>()
let ttlMs = DEFAULT_TTL_MS

function key(scope: ToolScope, type: ToolType, ctx: PathContext): string {
  return `${scope}|${type}|${ctx.shipProjectPath ?? ''}`
}

export function getCached(
  scope: ToolScope,
  type: ToolType,
  ctx: PathContext,
): ToolEntry[] | undefined {
  const e = cache.get(key(scope, type, ctx))
  if (!e) return undefined
  if (Date.now() > e.expiresAt) {
    cache.delete(key(scope, type, ctx))
    return undefined
  }
  return e.data
}

export function setCached(
  scope: ToolScope,
  type: ToolType,
  ctx: PathContext,
  data: ToolEntry[],
): void {
  cache.set(key(scope, type, ctx), { data, expiresAt: Date.now() + ttlMs })
}

/**
 * Drop matching cache entries. Any `undefined` arg is treated as a wildcard
 * for that dimension. `invalidate()` with no args clears everything.
 */
export function invalidate(
  scope?: ToolScope,
  type?: ToolType,
  ctx?: PathContext,
): void {
  if (scope === undefined && type === undefined && ctx === undefined) {
    cache.clear()
    return
  }
  const shipMatch = ctx?.shipProjectPath ?? ''
  for (const k of [...cache.keys()]) {
    const [s, t, ship] = k.split('|')
    if (scope && s !== scope) continue
    if (type && t !== type) continue
    if (ctx !== undefined && ship !== shipMatch) continue
    cache.delete(k)
  }
}

/** Clear everything. Used by tests and at shutdown. */
export function clear(): void {
  cache.clear()
}

/** Test-only: override the TTL. Returns the previous value for restoration. */
export function _setTtlForTests(newTtlMs: number): number {
  const prev = ttlMs
  ttlMs = newTtlMs
  return prev
}
