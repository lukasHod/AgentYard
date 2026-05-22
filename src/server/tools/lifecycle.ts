import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { type ToolEntry } from '../../core/tools.js'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'
import { toolOnDiskPath, type PathContext } from './paths.js'
import { writeTool } from './crud.js'

type EditableTarget = 'ship' | 'global'

/**
 * Adopt a tool from a catalog scope (.claude-*) into an editable scope (.agentyard).
 * For agents this is parse-transform-write (Claude → AgentYard field map).
 * For skills/scripts it's a directory copy.
 * For catalog MCPs (single entry in a shared file) it writes a standalone per-entry file.
 */
export function adoptTool(opts: {
  source: ToolEntry
  target: EditableTarget
  ctx: PathContext
}): { targetPath: string } {
  const { source, target, ctx } = opts
  if (source.scope !== 'claude-project' && source.scope !== 'claude-user') {
    throw new Error(`adoptTool: source must be in a catalog scope (got ${source.scope})`)
  }
  switch (source.type) {
    case 'skill':
      return adoptSkill(source, target, ctx)
    case 'agent':
      return adoptAgent(source, target, ctx)
    case 'mcp':
      return adoptCatalogMcp(source, target, ctx)
    case 'script':
      throw new Error('adoptTool: scripts have no catalog source; create directly instead')
  }
}

function adoptSkill(source: ToolEntry, target: EditableTarget, ctx: PathContext) {
  const dest = toolOnDiskPath(target, 'skill', source.data.name, ctx)
  if (!dest) throw new Error('adoptSkill: cannot resolve target')
  mkdirSync(path.dirname(dest), { recursive: true })
  cpSync(source.path, dest, { recursive: true, force: true })
  return { targetPath: dest }
}

function adoptAgent(source: ToolEntry, target: EditableTarget, ctx: PathContext) {
  if (source.type !== 'agent') throw new Error('adoptAgent: not an agent')
  // The scanner already normalized fields (mcpServers → mcps; defaults filled in).
  // Re-read the file just for the BODY (so we preserve it verbatim, untouched by yaml.dump).
  const raw = readFileSync(source.path, 'utf8')
  const { body } = parseFrontmatter(raw)
  // Write via crud.writeTool to keep the on-disk format consistent with manual edits.
  const targetPath = writeTool(target, 'agent', { ...source.data, prompt: body.trim() }, ctx)
  return { targetPath }
}

function adoptCatalogMcp(source: ToolEntry, target: EditableTarget, ctx: PathContext) {
  if (source.type !== 'mcp') throw new Error('adoptCatalogMcp: not an mcp')
  // Catalog MCPs are entries inside a shared .mcp.json. Adoption writes a
  // standalone per-entry .json in the editable scope.
  const targetPath = writeTool(target, 'mcp', source.data, ctx)
  return { targetPath }
}

/**
 * Elevate: move a per-ship tool to global. Workflow refs are by name; the
 * resolver finds the elevated tool on next read. The per-ship file is removed.
 */
export function elevateTool(source: ToolEntry, ctx: PathContext): { targetPath: string } {
  if (source.scope !== 'ship') {
    throw new Error(`elevateTool: source must be in 'ship' scope (got ${source.scope})`)
  }
  return moveOrCopy(source, 'global', ctx, 'move')
}

/** Fork: copy a global tool into per-ship (for ship-specific divergence). */
export function forkTool(source: ToolEntry, ctx: PathContext): { targetPath: string } {
  if (source.scope !== 'global') {
    throw new Error(`forkTool: source must be in 'global' scope (got ${source.scope})`)
  }
  return moveOrCopy(source, 'ship', ctx, 'copy')
}

function moveOrCopy(
  source: ToolEntry,
  target: EditableTarget,
  ctx: PathContext,
  mode: 'move' | 'copy',
): { targetPath: string } {
  const dest = toolOnDiskPath(target, source.type, source.data.name, ctx)
  if (!dest) throw new Error(`cannot resolve target path for ${source.type}/${source.data.name}`)
  mkdirSync(path.dirname(dest), { recursive: true })

  const isFolder = source.type === 'skill' || source.type === 'script'

  if (mode === 'move') {
    renameSync(source.path, dest)
  } else if (isFolder) {
    cpSync(source.path, dest, { recursive: true, force: true })
  } else {
    copyFileSync(source.path, dest)
  }
  return { targetPath: dest }
}

// Re-export the helpers some callers might want.
export { parseFrontmatter, serializeFrontmatter, writeFileSync, copyFileSync, cpSync }
