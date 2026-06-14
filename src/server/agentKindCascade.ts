import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { AgentKind } from '../core/plugins.js'
import { getDb } from './db.js'

/**
 * Phase 6: which AgentKind should drive a given chat / drone / leader?
 * Cascade per surface:
 *   Workflow node override > Feature default > Planet default > Global default
 *
 * Global default lives at `~/.agentyard/config.json`:
 *   { "defaultAgentKind": "claude-sdk" | "claude-code-cli" | "codex-cli" }
 * If absent, we fall back to 'claude-sdk' (unchanged from today).
 *
 * Lookups are cheap (a single PRAGMA-free SELECT each); cascade callers can
 * memo per request if hot enough later.
 */

const VALID_KINDS: ReadonlySet<AgentKind> = new Set<AgentKind>([
  'claude-sdk',
  'claude-code-cli',
  'codex-cli',
])

const CONFIG_PATH = path.join(homedir(), '.agentyard', 'config.json')

function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && VALID_KINDS.has(value as AgentKind)
}

let _cachedGlobal: AgentKind | null = null

export function getGlobalDefaultAgentKind(): AgentKind {
  if (_cachedGlobal) return _cachedGlobal
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { defaultAgentKind?: unknown }
      if (isAgentKind(raw.defaultAgentKind)) {
        _cachedGlobal = raw.defaultAgentKind
        return _cachedGlobal
      }
    } catch {
      // Fall through to default — never let a malformed config crash the server.
    }
  }
  _cachedGlobal = 'claude-sdk'
  return _cachedGlobal
}

/** Test/CLI hook — invalidate the global cache after writing config. */
export function refreshGlobalDefaultAgentKind(): void {
  _cachedGlobal = null
}

function lookupPlanetDefault(planetId: number): AgentKind | null {
  const row = getDb()
    .prepare('SELECT default_agent_kind FROM planets WHERE id = ?')
    .get(planetId) as { default_agent_kind?: string | null } | undefined
  return isAgentKind(row?.default_agent_kind) ? row!.default_agent_kind : null
}

function lookupFeatureDefault(featureId: number): AgentKind | null {
  const row = getDb()
    .prepare('SELECT default_agent_kind FROM features WHERE id = ?')
    .get(featureId) as { default_agent_kind?: string | null } | undefined
  return isAgentKind(row?.default_agent_kind) ? row!.default_agent_kind : null
}

export interface CascadeInput {
  /** Highest priority — node-level pin (workflow node's agentKind). */
  nodeOverride?: AgentKind | null
  /** Then feature-level pin. */
  featureId?: number | null
  /** Then planet-level pin. */
  planetId?: number | null
}

/**
 * Resolve an AgentKind for the surface described in `input`. Walks the
 * cascade top-to-bottom and returns the first concrete kind found. Falls
 * back to the global default if nothing along the chain is set.
 */
export function resolveAgentKind(input: CascadeInput): AgentKind {
  if (isAgentKind(input.nodeOverride)) return input.nodeOverride
  if (input.featureId != null) {
    const fk = lookupFeatureDefault(input.featureId)
    if (fk) return fk
  }
  if (input.planetId != null) {
    const pk = lookupPlanetDefault(input.planetId)
    if (pk) return pk
  }
  return getGlobalDefaultAgentKind()
}
