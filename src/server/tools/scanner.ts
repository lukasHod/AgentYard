import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  type AgentTool,
  type McpTool,
  type ScriptTool,
  type SkillTool,
  type ToolEntry,
  type ToolScope,
  type ToolType,
} from '../../core/tools.js'
import { parseFrontmatter } from './frontmatter.js'
import { catalogMcpFileCandidates, toolTypeDir, type PathContext } from './paths.js'
import { getCached, setCached } from './scanCache.js'

export type ScanContext = PathContext

const ALL_SCOPES: ToolScope[] = ['ship', 'global', 'claude-project', 'claude-user']
const ALL_TYPES: ToolType[] = ['skill', 'mcp', 'script', 'agent']

/** Find all tools of all types across all applicable scopes. Cached per scope+type+planet. */
export async function scanAllTools(ctx: ScanContext): Promise<ToolEntry[]> {
  const buckets = await Promise.all(
    ALL_SCOPES.flatMap((scope) => ALL_TYPES.map((type) => scanScopeType(scope, type, ctx))),
  )
  return buckets.flat()
}

/** Find tools of a specific type within a specific scope. Cached. */
export async function scanScopeType(
  scope: ToolScope,
  type: ToolType,
  ctx: ScanContext,
): Promise<ToolEntry[]> {
  const cached = getCached(scope, type, ctx)
  if (cached) return cached

  const fresh = await scanScopeTypeUncached(scope, type, ctx)
  setCached(scope, type, ctx, fresh)
  return fresh
}

async function scanScopeTypeUncached(
  scope: ToolScope,
  type: ToolType,
  ctx: ScanContext,
): Promise<ToolEntry[]> {
  if (type === 'mcp' && (scope === 'claude-project' || scope === 'claude-user')) {
    return scanCatalogMcps(scope, ctx)
  }
  const dir = toolTypeDir(scope, type, ctx)
  if (!dir) return []
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    // ENOENT or other read error — scope dir doesn't exist yet, treat as empty.
    return []
  }
  const parsed = await Promise.all(
    entries.map((entry) => parseToolAt(scope, type, entry, path.join(dir, entry))),
  )
  return parsed.filter((e): e is ToolEntry => e !== null)
}

async function parseToolAt(
  scope: ToolScope,
  type: ToolType,
  entry: string,
  fullPath: string,
): Promise<ToolEntry | null> {
  let st
  try {
    st = await stat(fullPath)
  } catch {
    return null
  }
  switch (type) {
    case 'skill':
      return st.isDirectory() ? parseSkillFolder(scope, entry, fullPath) : null
    case 'agent':
      return entry.endsWith('.md') && st.isFile() ? parseAgentFile(scope, entry, fullPath) : null
    case 'mcp':
      return entry.endsWith('.json') && st.isFile() ? parseMcpFile(scope, entry, fullPath) : null
    case 'script':
      return st.isDirectory() ? parseScriptFolder(scope, entry, fullPath) : null
  }
}

async function parseSkillFolder(
  scope: ToolScope,
  name: string,
  folder: string,
): Promise<ToolEntry | null> {
  const skillFile = path.join(folder, 'SKILL.md')
  let raw: string
  try {
    raw = await readFile(skillFile, 'utf8')
  } catch {
    return null
  }
  const { meta, body } = parseFrontmatter(raw)
  const data: SkillTool = {
    name: (meta.name as string) || name,
    description: (meta.description as string) || '',
    body: body.trim(),
  }
  return { type: 'skill', scope, path: folder, data }
}

async function parseAgentFile(
  scope: ToolScope,
  fileName: string,
  file: string,
): Promise<ToolEntry | null> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return null
  }
  const { meta, body } = parseFrontmatter(raw)
  const baseName = path.basename(fileName, '.md')
  // Normalize Claude format ↔ AgentYard format at parse time.
  const mcps =
    (Array.isArray(meta.mcps)
      ? meta.mcps
      : Array.isArray(meta.mcpServers)
        ? meta.mcpServers
        : []) as string[]
  const allowedTools =
    (Array.isArray(meta.allowedTools)
      ? meta.allowedTools
      : Array.isArray(meta.tools)
        ? meta.tools
        : undefined) as string[] | undefined
  const data: AgentTool = {
    name: (meta.name as string) || baseName,
    description: (meta.description as string) || '',
    role: (meta.role as string) || baseName,
    model: (meta.model as string) || undefined,
    toolPreset: (meta.toolPreset as 'none' | 'claude_code') || 'claude_code',
    allowedTools,
    skills: Array.isArray(meta.skills) ? (meta.skills as string[]) : [],
    mcps,
    scripts: Array.isArray(meta.scripts) ? (meta.scripts as string[]) : [],
    prompt: body.trim(),
  }
  return { type: 'agent', scope, path: file, data }
}

async function parseMcpFile(
  scope: ToolScope,
  fileName: string,
  file: string,
): Promise<ToolEntry | null> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  const transport = (j.transport as 'stdio' | 'http' | 'sse') ?? (j.command ? 'stdio' : 'http')
  const data: McpTool = {
    name: (j.name as string) || path.basename(fileName, '.json'),
    description: (j.description as string) ?? '',
    transport,
    command: j.command as string | undefined,
    args: Array.isArray(j.args) ? (j.args as string[]) : undefined,
    env: j.env as Record<string, string> | undefined,
    url: j.url as string | undefined,
    headers: j.headers as Record<string, string> | undefined,
  }
  return { type: 'mcp', scope, path: file, data }
}

async function parseScriptFolder(
  scope: ToolScope,
  name: string,
  folder: string,
): Promise<ToolEntry | null> {
  const manifestPath = path.join(folder, 'manifest.yaml')
  let raw: string
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>

  // Look for an optional body file next to the manifest.
  let bodyFile: string | undefined
  for (const candidate of ['script.sh', 'script.ps1', 'script.py', 'script.js', 'script.ts']) {
    try {
      await stat(path.join(folder, candidate))
      bodyFile = candidate
      break
    } catch {
      // not present
    }
  }

  const data: ScriptTool = {
    name: (p.name as string) || name,
    description: (p.description as string) ?? '',
    cmd: (p.cmd as string) ?? '',
    args: Array.isArray(p.args)
      ? (p.args as Array<{ name: string; description?: string; required?: boolean }>).map((a) => ({
          name: a.name,
          description: a.description,
          required: a.required ?? false,
        }))
      : [],
    bodyFile,
  }
  return { type: 'script', scope, path: folder, data }
}

/** Claude catalog stores all MCPs in a single shared file — split into virtual catalog entries. */
async function scanCatalogMcps(
  scope: 'claude-project' | 'claude-user',
  ctx: ScanContext,
): Promise<ToolEntry[]> {
  const candidates = catalogMcpFileCandidates(scope, ctx)
  let foundFile: string | null = null
  let raw: string | null = null
  for (const c of candidates) {
    try {
      raw = await readFile(c, 'utf8')
      foundFile = c
      break
    } catch {
      // try next candidate
    }
  }
  if (!foundFile || raw === null) return []
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return []
  }
  if (!json || typeof json !== 'object') return []
  const j = json as Record<string, unknown>
  const map = (j.mcpServers && typeof j.mcpServers === 'object'
    ? j.mcpServers
    : j) as Record<string, unknown>
  const out: ToolEntry[] = []
  for (const [name, cfg] of Object.entries(map)) {
    if (!cfg || typeof cfg !== 'object') continue
    const c = cfg as Record<string, unknown>
    const transport = (c.transport as 'stdio' | 'http' | 'sse') ?? (c.command ? 'stdio' : 'http')
    const data: McpTool = {
      name,
      description: (c.description as string) ?? '',
      transport,
      command: c.command as string | undefined,
      args: Array.isArray(c.args) ? (c.args as string[]) : undefined,
      env: c.env as Record<string, string> | undefined,
      url: c.url as string | undefined,
      headers: c.headers as Record<string, string> | undefined,
    }
    out.push({ type: 'mcp', scope, path: foundFile, data })
  }
  return out
}
