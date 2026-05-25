import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  assertValidToolName,
  isEditableScope,
  type AgentTool,
  type McpTool,
  type ScriptTool,
  type SkillTool,
  type ToolScope,
  type ToolType,
} from '../../core/tools.js'
import { serializeFrontmatter } from './frontmatter.js'
import { toolOnDiskPath, type PathContext } from './paths.js'

type AnyToolData = SkillTool | McpTool | ScriptTool | AgentTool
type EditableScope = 'ship' | 'global'

function ensureEditable(scope: ToolScope): asserts scope is EditableScope {
  if (!isEditableScope(scope)) {
    throw new Error(`Tool CRUD: scope "${scope}" is read-only`)
  }
}

/**
 * Create or overwrite a tool in an editable scope. The tool's `name` field
 * dictates the filename/folder. Returns the on-disk path.
 */
export function writeTool(
  scope: ToolScope,
  type: ToolType,
  data: AnyToolData,
  ctx: PathContext,
): string {
  ensureEditable(scope)
  // Defense in depth: ToolNameSchema already gates name at API parse time, but
  // writeTool is also called from in-process lifecycle helpers — re-check here.
  assertValidToolName(data.name)
  const target = toolOnDiskPath(scope, type, data.name, ctx)
  if (!target) {
    throw new Error(`writeTool: cannot resolve target path for ${scope}/${type}/${data.name}`)
  }
  mkdirSync(path.dirname(target), { recursive: true })
  switch (type) {
    case 'skill':
      writeSkill(target, data as SkillTool)
      break
    case 'agent':
      writeAgent(target, data as AgentTool)
      break
    case 'mcp':
      writeMcp(target, data as McpTool)
      break
    case 'script':
      writeScript(target, data as ScriptTool)
      break
  }
  return target
}

function writeSkill(folder: string, data: SkillTool): void {
  mkdirSync(folder, { recursive: true })
  const meta: Record<string, unknown> = {
    name: data.name,
    description: data.description,
  }
  writeFileSync(path.join(folder, 'SKILL.md'), serializeFrontmatter(meta, data.body), 'utf8')
}

function writeAgent(file: string, data: AgentTool): void {
  const meta: Record<string, unknown> = {
    name: data.name,
    description: data.description,
    role: data.role,
  }
  if (data.model) meta.model = data.model
  meta.toolPreset = data.toolPreset
  if (data.allowedTools && data.allowedTools.length > 0) meta.allowedTools = data.allowedTools
  meta.skills = data.skills
  meta.mcps = data.mcps
  meta.scripts = data.scripts
  writeFileSync(file, serializeFrontmatter(meta, data.prompt), 'utf8')
}

function writeMcp(file: string, data: McpTool): void {
  const obj: Record<string, unknown> = {
    name: data.name,
    description: data.description,
    transport: data.transport,
  }
  if (data.command !== undefined) obj.command = data.command
  if (data.args !== undefined) obj.args = data.args
  if (data.env !== undefined) obj.env = data.env
  if (data.url !== undefined) obj.url = data.url
  if (data.headers !== undefined) obj.headers = data.headers
  writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8')
}

function writeScript(folder: string, data: ScriptTool): void {
  mkdirSync(folder, { recursive: true })
  const manifest: Record<string, unknown> = {
    name: data.name,
    description: data.description,
    cmd: data.cmd,
    args: data.args,
  }
  writeFileSync(
    path.join(folder, 'manifest.yaml'),
    yaml.dump(manifest, { lineWidth: 0 }),
    'utf8',
  )
  // Optional body file. If the user provided `body`, write it to bodyFile (or default script.sh).
  if (data.body !== undefined && data.body.length > 0) {
    const bodyName = data.bodyFile || 'script.sh'
    writeFileSync(path.join(folder, bodyName), data.body, 'utf8')
  }
}

/** Read a tool's full data (including body for skills/agents, body file for scripts). */
export function readToolBody(filePath: string, type: ToolType): string | null {
  if (type === 'script') {
    // bodyFile inside script folder
    for (const candidate of ['script.sh', 'script.ps1', 'script.py', 'script.js', 'script.ts']) {
      const p = path.join(filePath, candidate)
      if (existsSync(p)) {
        try {
          return readFileSync(p, 'utf8')
        } catch {
          return null
        }
      }
    }
    return null
  }
  // For other types, the body is already inside the parsed entry.
  return null
}

/** Remove a tool from disk. Folder-based tools (skill/script) remove the folder. */
export function deleteTool(
  scope: ToolScope,
  type: ToolType,
  name: string,
  ctx: PathContext,
): void {
  ensureEditable(scope)
  assertValidToolName(name)
  const target = toolOnDiskPath(scope, type, name, ctx)
  if (!target) {
    throw new Error(`deleteTool: cannot resolve target path for ${scope}/${type}/${name}`)
  }
  if (!existsSync(target)) return
  const st = statSync(target)
  rmSync(target, { recursive: st.isDirectory(), force: true })
}
