import { z } from 'zod/v4'

// ============================================================
// Tool name validation
// ============================================================

/**
 * Tool names map directly to on-disk filenames (agents/mcps) or folder names
 * (skills/scripts). Anything that could break out of the configured scope root
 * — path separators, parent-dir refs, leading dots — is rejected here so we
 * never have to trust the name at write/delete time.
 *
 * Allowed: ASCII letters, digits, `.`, `_`, `-`. Length 1-64.
 * Rejected: path separators, `..`, names starting with `.`, anything else.
 */
const TOOL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function isValidToolName(s: string): boolean {
  if (!TOOL_NAME_RE.test(s)) return false
  if (s.includes('..')) return false
  return true
}

export function assertValidToolName(s: string): void {
  if (!isValidToolName(s)) {
    throw new Error(`Invalid tool name: ${JSON.stringify(s)}`)
  }
}

export const ToolNameSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidToolName, {
    message:
      'Tool name must be 1-64 chars of letters/digits/._- (no path separators, no leading dot, no "..")',
  })

// ============================================================
// Tool types + scopes
// ============================================================

export const ToolTypeSchema = z.enum(['skill', 'mcp', 'script', 'agent'])
export type ToolType = z.infer<typeof ToolTypeSchema>

/**
 * Four sources for tools:
 *  - claude-project: <ship>/.claude/...    (read-only catalog, project-level)
 *  - claude-user:    ~/.claude/...         (read-only catalog, user-level)
 *  - ship:           <ship>/.agentyard/... (editable, per-ship, version-controlled with repo)
 *  - global:         ~/.agentyard/...      (editable, cross-ship)
 *
 * Resolution at runtime walks ship → global → error. Catalog never resolves
 * directly; must be adopted into ship or global first.
 */
export const ToolScopeSchema = z.enum(['claude-project', 'claude-user', 'ship', 'global'])
export type ToolScope = z.infer<typeof ToolScopeSchema>

export const READ_ONLY_SCOPES: readonly ToolScope[] = ['claude-project', 'claude-user'] as const
export const EDITABLE_SCOPES: readonly ToolScope[] = ['ship', 'global'] as const

export function isEditableScope(s: ToolScope): boolean {
  return EDITABLE_SCOPES.includes(s)
}

export function isCatalogScope(s: ToolScope): boolean {
  return READ_ONLY_SCOPES.includes(s)
}

/** Default adoption target for a given catalog source — matches the design's "follow the source" default. */
export function defaultAdoptionTarget(source: ToolScope): 'ship' | 'global' {
  if (source === 'claude-project') return 'ship'
  if (source === 'claude-user') return 'global'
  throw new Error(`Not a catalog scope: ${source}`)
}

// ============================================================
// Per-type tool shapes
// ============================================================

/** A SKILL — markdown text + frontmatter; loaded into a drone's system prompt. */
export const SkillToolSchema = z.object({
  name: ToolNameSchema,
  description: z.string().default(''),
  body: z.string().default(''),
})
export type SkillTool = z.infer<typeof SkillToolSchema>

/** Transport kind for an MCP server. */
export const McpTransportSchema = z.enum(['stdio', 'http', 'sse'])
export type McpTransport = z.infer<typeof McpTransportSchema>

/**
 * An MCP server config. `${env:VAR}` substitution is applied at spawn time to
 * any string field (env values, args, url, headers). Substitution is resolved
 * from `process.env` after the optional secrets file is loaded; the on-disk
 * file is never mutated.
 */
export const McpToolSchema = z.object({
  name: ToolNameSchema,
  description: z.string().default(''),
  transport: McpTransportSchema,
  // transport === 'stdio'
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  // transport === 'http' | 'sse'
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})
export type McpTool = z.infer<typeof McpToolSchema>

/** A declared argument for a script — surfaces in the agent-facing tool schema. */
export const ScriptArgSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(false),
})
export type ScriptArg = z.infer<typeof ScriptArgSchema>

/**
 * A SCRIPT — a wrapped shell command. `cmd:` is authoritative; implicit
 * script.sh execution is not supported. For non-trivial logic, place a
 * body file next to manifest.yaml and reference it explicitly, e.g.
 * `cmd: "bash script.sh {filter}"`.
 */
export const ScriptToolSchema = z.object({
  name: ToolNameSchema,
  description: z.string().default(''),
  cmd: z.string().min(1),
  args: z.array(ScriptArgSchema).default([]),
  /** Filename (e.g. "script.sh") of a sibling body file, if one exists. Populated at scan time. */
  bodyFile: z.string().optional(),
  /** Body contents — populated lazily on edit / preview, never in list payloads. */
  body: z.string().optional(),
})
export type ScriptTool = z.infer<typeof ScriptToolSchema>

/** Tool preset selector for an agent — mirrors Session.ToolPreset. */
export const AgentToolPresetSchema = z.enum(['none', 'claude_code'])
export type AgentToolPreset = z.infer<typeof AgentToolPresetSchema>

/**
 * An AGENT — a drone preset. Frontmatter borrows from Claude Code's agent
 * file format where possible, but the on-disk schema is AgentYard's:
 *
 *   `mcpServers` (Claude)  →  `mcps`   (AgentYard)
 *   `tools`     (Claude)   →  `allowedTools` (AgentYard)
 *
 * plus AgentYard extensions: `role`, `toolPreset`, `scripts`.
 *
 * Adopting from .claude/ goes through lifecycle.adopt which performs the
 * transform (renames, supplies defaults), never a raw copy.
 */
export const AgentToolSchema = z.object({
  name: ToolNameSchema,
  description: z.string().default(''),
  role: z.string().default(''),
  model: z.string().optional(),
  toolPreset: AgentToolPresetSchema.default('claude_code'),
  allowedTools: z.array(z.string()).optional(),
  skills: z.array(z.string()).default([]),
  mcps: z.array(z.string()).default([]),
  scripts: z.array(z.string()).default([]),
  /** System prompt — body of the .md file after frontmatter. */
  prompt: z.string().default(''),
})
export type AgentTool = z.infer<typeof AgentToolSchema>

// ============================================================
// ToolEntry — full tool with origin metadata
// ============================================================

/**
 * A tool plus where it came from. Returned by the detail endpoint
 * (`GET /api/tool/:scope/:type/:name`) and by the scanner for in-memory
 * use. The discriminated `type` field selects the payload shape.
 */
export const ToolEntrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('skill'),
    scope: ToolScopeSchema,
    path: z.string(),
    data: SkillToolSchema,
  }),
  z.object({
    type: z.literal('mcp'),
    scope: ToolScopeSchema,
    path: z.string(),
    data: McpToolSchema,
  }),
  z.object({
    type: z.literal('script'),
    scope: ToolScopeSchema,
    path: z.string(),
    data: ScriptToolSchema,
  }),
  z.object({
    type: z.literal('agent'),
    scope: ToolScopeSchema,
    path: z.string(),
    data: AgentToolSchema,
  }),
])
export type ToolEntry = z.infer<typeof ToolEntrySchema>

// ============================================================
// ToolSummary — list payload (no body / prompt / secrets)
// ============================================================

/**
 * Slim shape returned by list endpoints. Browsing the library doesn't need
 * the full body of every skill or the prompt of every agent; that's fetched
 * on demand when the user opens the editor for one.
 */
export const ToolSummarySchema = z.object({
  type: ToolTypeSchema,
  scope: ToolScopeSchema,
  name: z.string(),
  description: z.string(),
  /** Absolute path to the tool's file or folder on disk. */
  path: z.string(),
})
export type ToolSummary = z.infer<typeof ToolSummarySchema>

export function toolEntryToSummary(entry: ToolEntry): ToolSummary {
  return {
    type: entry.type,
    scope: entry.scope,
    name: entry.data.name,
    description: entry.data.description,
    path: entry.path,
  }
}

// ============================================================
// ToolRef — by-name reference (workflow nodes / agent capabilities)
// ============================================================

/**
 * A reference to a tool by type + name. Scope is intentionally NOT part of
 * the ref — the resolver walks ship → global at read time so elevating a
 * per-ship tool to global doesn't break the references that point at it.
 */
export const ToolRefSchema = z.object({
  type: ToolTypeSchema,
  name: z.string().min(1),
})
export type ToolRef = z.infer<typeof ToolRefSchema>
