import type { ToolEntry, ToolType } from '../../core/tools.js'
import { scanScopeType, type ScanContext } from './scanner.js'

/**
 * Resolve a tool by type + name. Walks `ship` → `global` and returns the first match,
 * or null if not found. Catalog scopes (`claude-*`) are NOT consulted — those entries
 * must be adopted into an editable scope first.
 */
export function resolveTool(type: ToolType, name: string, ctx: ScanContext): ToolEntry | null {
  for (const scope of ['ship', 'global'] as const) {
    const entries = scanScopeType(scope, type, ctx)
    const match = entries.find((e) => e.data.name === name)
    if (match) return match
  }
  return null
}

/** Resolve many at once — convenience for materializing a workflow node's agent list. */
export function resolveToolMany(type: ToolType, names: string[], ctx: ScanContext): {
  resolved: ToolEntry[]
  missing: string[]
} {
  const resolved: ToolEntry[] = []
  const missing: string[] = []
  for (const name of names) {
    const r = resolveTool(type, name, ctx)
    if (r) resolved.push(r)
    else missing.push(name)
  }
  return { resolved, missing }
}
