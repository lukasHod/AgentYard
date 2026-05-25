import type { FastifyReply } from 'fastify'
import {
  AgentToolSchema,
  McpToolSchema,
  ScriptToolSchema,
  SkillToolSchema,
  ToolScopeSchema,
  ToolTypeSchema,
  toolEntryToSummary,
  type ToolEntry,
  type ToolScope,
  type ToolSummary,
  type ToolType,
} from '../../core/tools.js'
import { getShip } from '../ships.js'
import { writeTool, deleteTool, readToolBody } from '../tools/crud.js'
import { adoptTool, elevateTool, forkTool } from '../tools/lifecycle.js'
import type { PathContext } from '../tools/paths.js'
import { scanAllTools, scanScopeType } from '../tools/scanner.js'
import type { AppContext } from './context.js'

/** Parse `type` from URL and reject malformed values. */
function parseToolType(s: unknown, reply: FastifyReply): ToolType | null {
  const parsed = ToolTypeSchema.safeParse(s)
  if (!parsed.success) {
    reply.code(400).send({ error: `Invalid tool type: ${String(s)}` })
    return null
  }
  return parsed.data
}

function parseToolScope(s: unknown, reply: FastifyReply): ToolScope | null {
  const parsed = ToolScopeSchema.safeParse(s)
  if (!parsed.success) {
    reply.code(400).send({ error: `Invalid scope: ${String(s)}` })
    return null
  }
  return parsed.data
}

/** Pick the right Zod schema for the data field of a given tool type. */
function parseToolData(type: ToolType, data: unknown, reply: FastifyReply) {
  const schema =
    type === 'skill'
      ? SkillToolSchema
      : type === 'agent'
        ? AgentToolSchema
        : type === 'mcp'
          ? McpToolSchema
          : ScriptToolSchema
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    reply.code(400).send({ error: parsed.error.message })
    return null
  }
  return parsed.data
}

export function registerToolRoutes({ app, apiError }: AppContext): void {
  // --- Lists ---
  app.get<{ Params: { id: string } }>('/api/ships/:id/tools', async (req, reply) => {
    const ship = getShip(Number(req.params.id))
    if (!ship) return reply.code(404).send({ error: 'ship not found' })
    const ctx: PathContext = { shipProjectPath: ship.projectPath }
    const entries = await scanAllTools(ctx)
    return entries.map(toolEntryToSummary) as ToolSummary[]
  })

  app.get('/api/global-tools', async () => {
    const ctx: PathContext = { shipProjectPath: null }
    // Global-only view: include global (~/.agentyard) + user catalog (~/.claude). Skip ship + claude-project.
    const buckets = await Promise.all(
      (['global', 'claude-user'] as const).flatMap((scope) =>
        (['skill', 'mcp', 'script', 'agent'] as const).map((type) =>
          scanScopeType(scope, type, ctx),
        ),
      ),
    )
    return buckets.flat().map(toolEntryToSummary) as ToolSummary[]
  })

  // --- Detail (with full data) ---
  app.get<{ Params: { id: string; scope: string; type: string; name: string } }>(
    '/api/ships/:id/tools/:scope/:type/:name',
    async (req, reply) => {
      const ship = getShip(Number(req.params.id))
      if (!ship) return reply.code(404).send({ error: 'ship not found' })
      const scope = parseToolScope(req.params.scope, reply)
      const type = parseToolType(req.params.type, reply)
      if (!scope || !type) return
      const ctx: PathContext = { shipProjectPath: ship.projectPath }
      const entry = (await scanScopeType(scope, type, ctx)).find(
        (e) => e.data.name === req.params.name,
      )
      if (!entry) return reply.code(404).send({ error: 'not found' })
      const result = entry as ToolEntry & { data: { body?: string } }
      if (entry.type === 'script' && entry.data.bodyFile) {
        const body = readToolBody(entry.path, 'script')
        if (body !== null) {
          return { ...entry, data: { ...entry.data, body } }
        }
      }
      return result
    },
  )

  app.get<{ Params: { type: string; name: string } }>(
    '/api/global-tools/:type/:name',
    async (req, reply) => {
      const type = parseToolType(req.params.type, reply)
      if (!type) return
      const ctx: PathContext = { shipProjectPath: null }
      const entry = (await scanScopeType('global', type, ctx)).find(
        (e) => e.data.name === req.params.name,
      )
      if (!entry) return reply.code(404).send({ error: 'not found' })
      if (entry.type === 'script' && entry.data.bodyFile) {
        const body = readToolBody(entry.path, 'script')
        if (body !== null) return { ...entry, data: { ...entry.data, body } }
      }
      return entry
    },
  )

  // --- Create / update ---
  app.post<{ Params: { id: string; type: string }; Body: { data: unknown } }>(
    '/api/ships/:id/tools/:type',
    async (req, reply) => {
      const ship = getShip(Number(req.params.id))
      if (!ship) return reply.code(404).send({ error: 'ship not found' })
      const type = parseToolType(req.params.type, reply)
      if (!type) return
      const data = parseToolData(type, req.body?.data, reply)
      if (!data) return
      const ctx: PathContext = { shipProjectPath: ship.projectPath }
      const targetPath = writeTool('ship', type, data, ctx)
      return { ok: true, path: targetPath }
    },
  )

  app.post<{ Params: { type: string }; Body: { data: unknown } }>(
    '/api/global-tools/:type',
    async (req, reply) => {
      const type = parseToolType(req.params.type, reply)
      if (!type) return
      const data = parseToolData(type, req.body?.data, reply)
      if (!data) return
      const targetPath = writeTool('global', type, data, { shipProjectPath: null })
      return { ok: true, path: targetPath }
    },
  )

  app.put<{ Params: { id: string; type: string; name: string }; Body: { data: unknown } }>(
    '/api/ships/:id/tools/:type/:name',
    async (req, reply) => {
      const ship = getShip(Number(req.params.id))
      if (!ship) return reply.code(404).send({ error: 'ship not found' })
      const type = parseToolType(req.params.type, reply)
      if (!type) return
      const data = parseToolData(type, req.body?.data, reply)
      if (!data) return
      // Reject rename via PUT (would orphan the old file). Names must match URL.
      if (data.name !== req.params.name) {
        return reply.code(400).send({ error: 'cannot rename via PUT; name must match URL' })
      }
      const ctx: PathContext = { shipProjectPath: ship.projectPath }
      const targetPath = writeTool('ship', type, data, ctx)
      return { ok: true, path: targetPath }
    },
  )

  app.put<{ Params: { type: string; name: string }; Body: { data: unknown } }>(
    '/api/global-tools/:type/:name',
    async (req, reply) => {
      const type = parseToolType(req.params.type, reply)
      if (!type) return
      const data = parseToolData(type, req.body?.data, reply)
      if (!data) return
      if (data.name !== req.params.name) {
        return reply.code(400).send({ error: 'cannot rename via PUT; name must match URL' })
      }
      const targetPath = writeTool('global', type, data, { shipProjectPath: null })
      return { ok: true, path: targetPath }
    },
  )

  // --- Delete ---
  app.delete<{ Params: { id: string; type: string; name: string } }>(
    '/api/ships/:id/tools/:type/:name',
    async (req, reply) => {
      const ship = getShip(Number(req.params.id))
      if (!ship) return reply.code(404).send({ error: 'ship not found' })
      const type = parseToolType(req.params.type, reply)
      if (!type) return
      const ctx: PathContext = { shipProjectPath: ship.projectPath }
      deleteTool('ship', type, req.params.name, ctx)
      return { ok: true }
    },
  )

  app.delete<{ Params: { type: string; name: string } }>(
    '/api/global-tools/:type/:name',
    async (req, reply) => {
      const type = parseToolType(req.params.type, reply)
      if (!type) return
      deleteTool('global', type, req.params.name, { shipProjectPath: null })
      return { ok: true }
    },
  )

  // --- Lifecycle: adopt / elevate / fork ---
  app.post<{
    Params: { id: string }
    Body: { sourceScope: string; type: string; name: string; target: string }
  }>('/api/ships/:id/tools/adopt', async (req, reply) => {
    const ship = getShip(Number(req.params.id))
    if (!ship) return reply.code(404).send({ error: 'ship not found' })
    const body = req.body ?? ({} as Record<string, string>)
    const sourceScope = parseToolScope(body.sourceScope, reply)
    const type = parseToolType(body.type, reply)
    if (!sourceScope || !type) return
    if (sourceScope !== 'claude-project' && sourceScope !== 'claude-user') {
      return reply.code(400).send({ error: 'adopt: sourceScope must be a claude-* catalog scope' })
    }
    const target = body.target === 'global' ? 'global' : 'ship'
    const ctx: PathContext = { shipProjectPath: ship.projectPath }
    const entries = await scanScopeType(sourceScope, type, ctx)
    const source = entries.find((e) => e.data.name === body.name)
    if (!source) return reply.code(404).send({ error: 'source tool not found in catalog' })
    try {
      const { targetPath } = adoptTool({ source, target, ctx })
      return { ok: true, target, path: targetPath }
    } catch (e) {
      return apiError(reply, 500, 'failed to adopt tool', e)
    }
  })

  app.post<{ Body: { type: string; name: string } }>(
    '/api/global-tools/adopt',
    async (req, reply) => {
      const body = req.body ?? ({} as Record<string, string>)
      const type = parseToolType(body.type, reply)
      if (!type) return
      const ctx: PathContext = { shipProjectPath: null }
      const entries = await scanScopeType('claude-user', type, ctx)
      const source = entries.find((e) => e.data.name === body.name)
      if (!source) return reply.code(404).send({ error: 'source not found in user catalog' })
      try {
        const { targetPath } = adoptTool({ source, target: 'global', ctx })
        return { ok: true, target: 'global', path: targetPath }
      } catch (e) {
        return apiError(reply, 500, 'failed to adopt tool', e)
      }
    },
  )

  app.post<{ Params: { id: string; type: string; name: string } }>(
    '/api/ships/:id/tools/:type/:name/elevate',
    async (req, reply) => {
      const ship = getShip(Number(req.params.id))
      if (!ship) return reply.code(404).send({ error: 'ship not found' })
      const type = parseToolType(req.params.type, reply)
      if (!type) return
      const ctx: PathContext = { shipProjectPath: ship.projectPath }
      const source = (await scanScopeType('ship', type, ctx)).find(
        (e) => e.data.name === req.params.name,
      )
      if (!source) return reply.code(404).send({ error: 'tool not found in per-ship scope' })
      try {
        const { targetPath } = elevateTool(source, ctx)
        return { ok: true, path: targetPath }
      } catch (e) {
        return apiError(reply, 500, 'failed to elevate tool', e)
      }
    },
  )

  app.post<{ Params: { id: string; type: string; name: string } }>(
    '/api/ships/:id/tools/:type/:name/fork-from-global',
    async (req, reply) => {
      const ship = getShip(Number(req.params.id))
      if (!ship) return reply.code(404).send({ error: 'ship not found' })
      const type = parseToolType(req.params.type, reply)
      if (!type) return
      const ctx: PathContext = { shipProjectPath: ship.projectPath }
      const source = (await scanScopeType('global', type, ctx)).find(
        (e) => e.data.name === req.params.name,
      )
      if (!source) return reply.code(404).send({ error: 'tool not found in global scope' })
      try {
        const { targetPath } = forkTool(source, ctx)
        return { ok: true, path: targetPath }
      } catch (e) {
        return apiError(reply, 500, 'failed to fork tool', e)
      }
    },
  )
}
