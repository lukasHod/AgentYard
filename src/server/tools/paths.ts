import path from 'node:path'
import { homedir } from 'node:os'
import type { ToolScope, ToolType } from '../../core/tools.js'

export interface PathContext {
  /** Absolute path to the planet's project root. Null when there's no planet context (galaxy library view). */
  planetProjectPath: string | null
}

/**
 * Resolve the user's `.agentyard` root. Defaults to `<homedir>/.agentyard`.
 *
 * If the `AGENTYARD_HOME` env var is set, it's used verbatim — useful for
 * portable installs and required by the test suite (which can't safely
 * monkey-patch `os.homedir()` cross-platform).
 */
export function agentyardHome(): string {
  return process.env.AGENTYARD_HOME ?? path.join(homedir(), '.agentyard')
}

/** Root directory for a (scope, ctx) tuple. Returns null if the scope is N/A for the context. */
export function scopeRoot(scope: ToolScope, ctx: PathContext): string | null {
  switch (scope) {
    case 'planet':
      return ctx.planetProjectPath ? path.join(ctx.planetProjectPath, '.agentyard') : null
    case 'global':
      return agentyardHome()
    case 'claude-project':
      return ctx.planetProjectPath ? path.join(ctx.planetProjectPath, '.claude') : null
    case 'claude-user':
      return path.join(homedir(), '.claude')
  }
}

/** Directory holding tools of a given type within a scope. Null if N/A. */
export function toolTypeDir(scope: ToolScope, type: ToolType, ctx: PathContext): string | null {
  const root = scopeRoot(scope, ctx)
  if (!root) return null
  // Scripts have no Claude catalog convention — skip.
  if (type === 'script' && (scope === 'claude-project' || scope === 'claude-user')) {
    return null
  }
  // Catalog MCPs live as entries in a shared file at the scope root, not in a folder.
  if (type === 'mcp' && (scope === 'claude-project' || scope === 'claude-user')) {
    return root
  }
  return path.join(root, `${type}s`)
}

/**
 * Canonical on-disk path for a specific tool.
 * - Folder-based (skill, script): folder path
 * - File-based (agent, mcp): file path
 * - Catalog MCP: the shared .mcp.json file path (multiple MCPs share this)
 */
export function toolOnDiskPath(
  scope: ToolScope,
  type: ToolType,
  name: string,
  ctx: PathContext,
): string | null {
  const dir = toolTypeDir(scope, type, ctx)
  if (!dir) return null
  switch (type) {
    case 'skill':
    case 'script':
      return path.join(dir, name)
    case 'agent':
      return path.join(dir, `${name}.md`)
    case 'mcp':
      if (scope === 'claude-project' || scope === 'claude-user') {
        // Catalog MCPs: the path is the shared .mcp.json. The scanner finds the real file
        // among candidates; callers that need the actual file should use catalogMcpFileCandidates.
        return path.join(dir, '.mcp.json')
      }
      return path.join(dir, `${name}.json`)
  }
}

/**
 * Candidate paths for Claude Code's per-scope MCP config file. Claude Code accepts
 * `<project>/.mcp.json` (the doc'd location), but some users keep it at `.claude/mcp.json`
 * — we check both. First existing one is the source of truth.
 */
export function catalogMcpFileCandidates(scope: ToolScope, ctx: PathContext): string[] {
  const root = scopeRoot(scope, ctx)
  if (!root) return []
  if (scope === 'claude-project' && ctx.planetProjectPath) {
    return [
      path.join(root, '.mcp.json'),                       // <planet>/.claude/.mcp.json
      path.join(root, 'mcp.json'),                        // <planet>/.claude/mcp.json
      path.join(ctx.planetProjectPath, '.mcp.json'),        // <planet>/.mcp.json (Claude's doc'd location)
    ]
  }
  if (scope === 'claude-user') {
    return [
      path.join(root, '.mcp.json'),
      path.join(root, 'mcp.json'),
    ]
  }
  return []
}

/** Where AgentYard's optional secrets file lives (respects `AGENTYARD_HOME`). */
export function secretsFile(): string {
  return path.join(agentyardHome(), '.secrets', 'secrets.env')
}
