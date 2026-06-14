import type { ToolEntry, ToolType } from '../../core/tools.js'
import { scanScopeType, type ScanContext } from './scanner.js'

/**
 * Resolve a tool by type + name. Editable scopes shadow read-only catalog scopes.
 * Agents themselves still resolve only from `planet` → `global`, because workflow
 * nodes need AgentYard's normalized agent schema. Agent capabilities (skills,
 * scripts, MCPs) can also come from `.claude/` catalogs so project rules are
 * selectable without a separate adoption step.
 */
export async function resolveTool(
  type: ToolType,
  name: string,
  ctx: ScanContext,
): Promise<ToolEntry | null> {
  const scopes =
    type === 'agent'
      ? (['planet', 'global'] as const)
      : (['planet', 'global', 'claude-project', 'claude-user'] as const)
  for (const scope of scopes) {
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
