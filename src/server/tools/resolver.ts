import type { ToolEntry, ToolType } from '../../core/tools.js'
import { scanScopeType, type ScanContext } from './scanner.js'

/**
 * Resolve a tool by type + name. Walks `ship` → `global` and returns the first match,
 * or null if not found. Catalog scopes (`claude-*`) are NOT consulted — those entries
 * must be adopted into an editable scope first.
 */
export async function resolveTool(
  type: ToolType,
  name: string,
  ctx: ScanContext,
): Promise<ToolEntry | null> {
  for (const scope of ['ship', 'global'] as const) {
    const entries = await scanScopeType(scope, type, ctx)
    const match = entries.find((e) => e.data.name === name)
    if (match) return match
  }
  return null
}

/** Resolve many at once — convenience for materializing a workflow node's agent list. */
export async function resolveToolMany(
  type: ToolType,
  names: string[],
  ctx: ScanContext,
): Promise<{ resolved: ToolEntry[]; missing: string[] }> {
  const results = await Promise.all(names.map((name) => resolveTool(type, name, ctx)))
  const resolved: ToolEntry[] = []
  const missing: string[] = []
  for (let i = 0; i < names.length; i++) {
    const r = results[i]
    if (r) resolved.push(r)
    else missing.push(names[i]!)
  }
  return { resolved, missing }
}
