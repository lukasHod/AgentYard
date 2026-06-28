import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod/v4'
import type { AgentKind } from '../core/plugins.js'
import { getDb } from './db.js'
import { getPlanetSetting } from './planetSettings.js'

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

const GlobalAgentKindConfigSchema = z.object({
  defaultAgentKind: z.enum(['claude-sdk', 'claude-code-cli', 'codex-cli']).optional(),
})

const CONFIG_PATH = path.join(homedir(), '.agentyard', 'config.json')

function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && VALID_KINDS.has(value as AgentKind)
}

let _cachedGlobal: AgentKind | null = null

export function getGlobalDefaultAgentKind(): AgentKind {
  if (_cachedGlobal) return _cachedGlobal
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = GlobalAgentKindConfigSchema.parse(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')))
      if (raw.defaultAgentKind) {
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

function lookupPlanetDefault(planetId: number, context: 'workflow' | 'terminal'): AgentKind | null {
  const row = getDb()
    .prepare('SELECT default_agent_kind FROM planets WHERE id = ?')
    .get(planetId) as { default_agent_kind?: string | null } | undefined
  if (isAgentKind(row?.default_agent_kind)) return row!.default_agent_kind
  // For terminal spawns (planet view, manual sessions), honour the terminal-type
  // setting so claude-cli planets open Claude Code CLI by default.
  // For workflow spawns, skip this: the terminal-type preference is about the
  // interactive planet terminal, NOT which agent SDK runs workflow nodes.
  // Workflow nodes default to 'claude-sdk' via getGlobalDefaultAgentKind().
  if (context === 'terminal') {
    const terminalType = getPlanetSetting(planetId, 'default-terminal-type')
    if (terminalType === 'claude-cli') return 'claude-code-cli'
  }
  return null
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
 *
 * `context` controls whether the planet's `default-terminal-type` setting is
 * consulted: pass `'terminal'` for interactive planet/manual terminal spawns;
 * pass `'workflow'` for workflow node agent spawns. Workflow nodes should use
 * `'claude-sdk'` by default regardless of terminal-type, which is a user-
 * facing preference for the interactive terminal only.
 */
export function resolveAgentKind(input: CascadeInput, context: 'workflow' | 'terminal' = 'terminal'): AgentKind {
  if (isAgentKind(input.nodeOverride)) return input.nodeOverride
  if (input.featureId != null) {
    const fk = lookupFeatureDefault(input.featureId)
    if (fk) return fk
  }
  if (input.planetId != null) {
    const pk = lookupPlanetDefault(input.planetId, context)
    if (pk) return pk
  }
  return getGlobalDefaultAgentKind()
}

// ── Model cascade ─────────────────────────────────────────────────────────────

const GlobalModelConfigSchema = z.object({
  defaultModel: z.string().optional(),
})

let _cachedGlobalModel: string | null | undefined = undefined // undefined = not loaded

function getGlobalDefaultModel(): string | undefined {
  if (_cachedGlobalModel !== undefined) return _cachedGlobalModel ?? undefined
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = GlobalModelConfigSchema.parse(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')))
      _cachedGlobalModel = raw.defaultModel ?? null
      return _cachedGlobalModel ?? undefined
    } catch {
      // Fall through — malformed config is not fatal.
    }
  }
  _cachedGlobalModel = null
  return undefined
}

/** Test/CLI hook — invalidate the model cache after writing config. */
export function refreshGlobalDefaultModel(): void {
  _cachedGlobalModel = undefined
}

export interface ModelCascadeInput {
  /** Highest priority — agent definition's model (drone-level override). */
  agentModel?: string | null
  /** Then workflow node model (leader-level override). */
  nodeModel?: string | null
  /** Then planet default-model setting. */
  planetId?: number | null
}

/**
 * Resolve a model identifier. Most specific wins; returns undefined when
 * nothing is configured and the adapter should use its own built-in default.
 */
export function resolveModel(input: ModelCascadeInput): string | undefined {
  if (input.agentModel) return input.agentModel
  if (input.nodeModel) return input.nodeModel
  if (input.planetId != null) {
    const pm = getPlanetSetting(input.planetId, 'default-model')
    if (pm) return pm
  }
  return getGlobalDefaultModel()
}
