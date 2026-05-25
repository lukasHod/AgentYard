import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { Server as IOServer, type Socket } from 'socket.io'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { simpleGit } from 'simple-git'
import { closeDb, getDb } from './db.js'
import { SessionManager, type SessionDescriptor } from './runtime/SessionManager.js'
import type { Session, SessionEvent } from './runtime/Session.js'
import { runWorkflowOnSessions } from './runtime/runWorkflowOnSessions.js'
import {
  ensureDefaultWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
} from './workflows.js'
import { scanSkills } from './skills.js'
import { createShip, deleteShip, getShip, listShips } from './ships.js'
import { createFeature, getFeature, listFeatures, updateFeature, type Feature } from './features.js'
import { createFeatureWorktree, removeFeatureWorktree } from './runtime/worktrees.js'
import { TestRunRegistry } from './runtime/testRun.js'
import { loadSecrets } from './secrets.js'
import { seedDefaultAgentsIfMissing } from './agentsSeed.js'
import { seedDefaultScriptsIfMissing } from './scriptsSeed.js'
import { scanAllTools, scanScopeType } from './tools/scanner.js'
import { writeTool, deleteTool, readToolBody } from './tools/crud.js'
import { adoptTool, elevateTool, forkTool } from './tools/lifecycle.js'
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
} from '../core/tools.js'
import type { PathContext } from './tools/paths.js'

const execFileP = promisify(execFile)
import { WorkflowGraphSchema } from '../core/schema.js'
import type { RunEvent } from '../core/executor.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export interface ServerOptions {
  port: number
  dev: boolean
}

interface TranscriptEntry {
  role: 'assistant' | 'user' | 'system'
  content: string
  timestamp: number
}

interface PendingClarification {
  id: string
  question: string
}

export async function startServer(opts: ServerOptions) {
  getDb()
  // Seed scripts before workflow so the default workflow's script node has a
  // resolvable target on first boot.
  const seededScripts = seedDefaultScriptsIfMissing()
  if (seededScripts.wrote.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`seeded default scripts: ${seededScripts.wrote.join(', ')}`)
  }
  if (seededScripts.migrated.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `migrated legacy default scripts to argv-safe form: ${seededScripts.migrated.join(', ')}`,
    )
  }
  ensureDefaultWorkflow()
  scanSkills()
  const seeded = seedDefaultAgentsIfMissing()
  if (seeded.wrote.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`seeded default agents: ${seeded.wrote.join(', ')}`)
  }
  const secretsResult = loadSecrets()
  if (secretsResult.loaded > 0) {
    // eslint-disable-next-line no-console
    console.log(`loaded ${secretsResult.loaded} secret(s) from ${secretsResult.path}`)
  }

  const app = Fastify({ logger: true })

  if (!opts.dev) {
    const publicDir = path.resolve(here, '../public')
    if (existsSync(publicDir)) {
      await app.register(fastifyStatic, { root: publicDir })
    }
  }

  app.get('/api/health', async () => ({ ok: true, version: '0.0.1' }))

  /**
   * Send a sanitized error response. The full error (with stack + internal
   * paths) goes to the server log; the client only sees `publicMessage`.
   * Use this in every catch that builds a reply — never echo `err.message`
   * directly to the client.
   */
  function apiError(
    reply: import('fastify').FastifyReply,
    code: number,
    publicMessage: string,
    err?: unknown,
  ) {
    if (err !== undefined) {
      app.log.error({ err, status: code, publicMessage }, 'api error')
    } else {
      app.log.warn({ status: code, publicMessage }, 'api error')
    }
    return reply.code(code).send({ error: publicMessage })
  }

  const manager = new SessionManager()

  // Per-session bookkeeping for UI catch-up on connect.
  const transcripts = new Map<string, TranscriptEntry[]>()
  const pendingByAgent = new Map<string, Map<string, PendingClarification>>()
  const states = new Map<string, Session['state']>()

  // Track the active run so reconnects see in-progress status.
  let activeRun: {
    runId: string
    task: string
    nodeIds: string[]
    nodeStates: Record<string, 'pending' | 'running' | 'complete' | 'failed'>
    nodeSummaries: Record<string, string>
    finalSummary?: string
    error?: string
  } | null = null
  /**
   * AbortController for the in-flight run/feature. Set when a run starts and
   * cleared when it settles. `/api/runs/reset` signals abort here, so the
   * executor + script spawns + AI gate all stop deterministically before we
   * tear down sessions.
   */
  let activeRunController: AbortController | null = null
  /**
   * The promise driving the active run. Reset awaits this so it can't race
   * with the run's own state writes (which otherwise might land *after*
   * activeRun was nulled out).
   */
  let activeRunPromise: Promise<unknown> | null = null

  const io = new IOServer(app.server, {
    // In dev the UI is served by Vite on a different origin and needs CORS allow.
    // In prod the UI is served from the same Fastify origin, so refuse cross-origin
    // sockets — closes DNS-rebinding / cross-site Socket.IO connection vectors.
    cors: opts.dev ? { origin: 'http://localhost:5173' } : { origin: false },
  })

  manager.on('session:added', (desc: SessionDescriptor) => {
    states.set(desc.id, desc.state)
    transcripts.set(desc.id, [])
    pendingByAgent.set(desc.id, new Map())
    io.emit('session:added', desc)
  })

  manager.on('session:removed', (ev: { id: string }) => {
    io.emit('session:removed', ev)
  })

  manager.on('event', (ev: SessionEvent) => {
    const id = ev.agentRunId
    switch (ev.type) {
      case 'message': {
        const entry: TranscriptEntry = {
          role: ev.message.role,
          content: ev.message.text,
          timestamp: ev.message.timestamp,
        }
        transcripts.get(id)?.push(entry)
        io.emit('agent:message', { agentRunId: id, ...entry })
        break
      }
      case 'state': {
        states.set(id, ev.state)
        io.emit('agent:state', { agentRunId: id, state: ev.state })
        break
      }
      case 'clarification:requested': {
        pendingByAgent.get(id)?.set(ev.req.id, ev.req)
        io.emit('clarification:requested', {
          agentRunId: id,
          toolUseId: ev.req.id,
          question: ev.req.question,
        })
        break
      }
      case 'clarification:resolved': {
        pendingByAgent.get(id)?.delete(ev.id)
        io.emit('clarification:resolved', { agentRunId: id, toolUseId: ev.id })
        break
      }
      case 'closed': {
        app.log.info(`Session ${id} closed`)
        break
      }
    }
  })

  const testRuns = new TestRunRegistry(io)

  io.on('connection', (socket: Socket) => {
    app.log.info(`socket connected: ${socket.id}`)

    socket.emit('session:list', manager.describeAll())
    for (const [id, transcript] of transcripts) {
      for (const entry of transcript) {
        socket.emit('agent:message', { agentRunId: id, ...entry })
      }
      const state = states.get(id)
      if (state) socket.emit('agent:state', { agentRunId: id, state })
      const pendings = pendingByAgent.get(id)
      if (pendings) {
        for (const p of pendings.values()) {
          socket.emit('clarification:requested', {
            agentRunId: id,
            toolUseId: p.id,
            question: p.question,
          })
        }
      }
    }
    if (activeRun) socket.emit('run:snapshot', activeRun)

    socket.on('agent:send', (payload: { agentRunId: string; content: string }) => {
      if (typeof payload?.agentRunId !== 'string' || typeof payload?.content !== 'string') return
      if (payload.content.length === 0) return
      manager.get(payload.agentRunId)?.sendUserMessage(payload.content)
    })

    socket.on(
      'clarification:reply',
      (payload: { agentRunId: string; toolUseId: string; answer: string }) => {
        if (!payload?.agentRunId || !payload?.toolUseId || typeof payload.answer !== 'string') return
        manager.get(payload.agentRunId)?.resolveClarification(payload.toolUseId, payload.answer)
      },
    )

    socket.on(
      'test-run:agent:send',
      (payload: { testRunId: string; agentRunId: string; content: string }) => {
        if (
          typeof payload?.testRunId !== 'string' ||
          typeof payload?.agentRunId !== 'string' ||
          typeof payload?.content !== 'string'
        )
          return
        if (payload.content.length === 0) return
        testRuns.sendToAgent(payload.testRunId, payload.agentRunId, payload.content)
      },
    )

    socket.on(
      'test-run:clarification:reply',
      (payload: {
        testRunId: string
        agentRunId: string
        toolUseId: string
        answer: string
      }) => {
        if (
          !payload?.testRunId ||
          !payload?.agentRunId ||
          !payload?.toolUseId ||
          typeof payload.answer !== 'string'
        )
          return
        testRuns.replyClarification(
          payload.testRunId,
          payload.agentRunId,
          payload.toolUseId,
          payload.answer,
        )
      },
    )

    socket.on('disconnect', (reason) => {
      app.log.info(`socket disconnected: ${socket.id} (${reason})`)
    })
  })

  // -------------------------------------------------------------------
  // Workflow CRUD
  // -------------------------------------------------------------------
  app.get('/api/workflows', async () => listWorkflows())

  app.get<{ Params: { id: string } }>('/api/workflows/:id', async (req, reply) => {
    const wf = getWorkflow(Number(req.params.id))
    if (!wf) return reply.code(404).send({ error: 'not found' })
    return wf
  })

  app.put<{ Params: { id: string }; Body: { name?: string; graph?: unknown } }>(
    '/api/workflows/:id',
    async (req, reply) => {
      const id = Number(req.params.id)
      const patch: { name?: string; graph?: ReturnType<typeof WorkflowGraphSchema.parse> } = {}
      if (typeof req.body.name === 'string') patch.name = req.body.name
      if (req.body.graph !== undefined) {
        const parsed = WorkflowGraphSchema.safeParse(req.body.graph)
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
        patch.graph = parsed.data
      }
      const wf = updateWorkflow(id, patch)
      if (!wf) return reply.code(404).send({ error: 'not found' })
      return wf
    },
  )

  // -------------------------------------------------------------------
  // Tools (new tool model: skill / mcp / script / agent, 4 scopes)
  // -------------------------------------------------------------------
  function shipPathCtx(shipId?: number): PathContext {
    if (shipId === undefined) return { shipProjectPath: null }
    const ship = getShip(shipId)
    return { shipProjectPath: ship ? ship.projectPath : null }
  }

  /** Parse `type` from URL and reject malformed values. */
  function parseToolType(s: unknown, reply: import('fastify').FastifyReply): ToolType | null {
    const parsed = ToolTypeSchema.safeParse(s)
    if (!parsed.success) {
      reply.code(400).send({ error: `Invalid tool type: ${String(s)}` })
      return null
    }
    return parsed.data
  }

  function parseToolScope(s: unknown, reply: import('fastify').FastifyReply): ToolScope | null {
    const parsed = ToolScopeSchema.safeParse(s)
    if (!parsed.success) {
      reply.code(400).send({ error: `Invalid scope: ${String(s)}` })
      return null
    }
    return parsed.data
  }

  /** Pick the right Zod schema for the data field of a given tool type. */
  function parseToolData(type: ToolType, data: unknown, reply: import('fastify').FastifyReply) {
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

  // --- Lists ---
  app.get<{ Params: { id: string } }>('/api/ships/:id/tools', async (req, reply) => {
    const ship = getShip(Number(req.params.id))
    if (!ship) return reply.code(404).send({ error: 'ship not found' })
    const ctx: PathContext = { shipProjectPath: ship.projectPath }
    const entries = scanAllTools(ctx)
    return entries.map(toolEntryToSummary) as ToolSummary[]
  })

  app.get('/api/global-tools', async () => {
    const ctx: PathContext = { shipProjectPath: null }
    // Global-only view: include global (~/.agentyard) + user catalog (~/.claude). Skip ship + claude-project.
    const summaries: ToolSummary[] = []
    for (const scope of ['global', 'claude-user'] as const) {
      for (const type of ['skill', 'mcp', 'script', 'agent'] as const) {
        for (const e of scanScopeType(scope, type, ctx)) {
          summaries.push(toolEntryToSummary(e))
        }
      }
    }
    return summaries
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
      const entry = scanScopeType(scope, type, ctx).find((e) => e.data.name === req.params.name)
      if (!entry) return reply.code(404).send({ error: 'not found' })
      const result = entry as ToolEntry & { data: { body?: string } }
      // Lazy-load script body if requested.
      if (entry.type === 'script' && entry.data.bodyFile) {
        const body = readToolBody(entry.path, 'script')
        if (body !== null) {
          // Return a copy with body filled.
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
      const entry = scanScopeType('global', type, ctx).find((e) => e.data.name === req.params.name)
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
    const entries = scanScopeType(sourceScope, type, ctx)
    const source = entries.find((e) => e.data.name === body.name)
    if (!source) return reply.code(404).send({ error: 'source tool not found in catalog' })
    try {
      const { targetPath } = adoptTool({ source, target, ctx })
      return { ok: true, target, path: targetPath }
    } catch (e) {
      return apiError(reply, 500, 'failed to adopt tool', e)
    }
  })

  app.post<{ Body: { type: string; name: string } }>('/api/global-tools/adopt', async (req, reply) => {
    const body = req.body ?? ({} as Record<string, string>)
    const type = parseToolType(body.type, reply)
    if (!type) return
    const ctx: PathContext = { shipProjectPath: null }
    const entries = scanScopeType('claude-user', type, ctx)
    const source = entries.find((e) => e.data.name === body.name)
    if (!source) return reply.code(404).send({ error: 'source not found in user catalog' })
    try {
      const { targetPath } = adoptTool({ source, target: 'global', ctx })
      return { ok: true, target: 'global', path: targetPath }
    } catch (e) {
      return apiError(reply, 500, 'failed to adopt tool', e)
    }
  })

  app.post<{ Params: { id: string; type: string; name: string } }>(
    '/api/ships/:id/tools/:type/:name/elevate',
    async (req, reply) => {
      const ship = getShip(Number(req.params.id))
      if (!ship) return reply.code(404).send({ error: 'ship not found' })
      const type = parseToolType(req.params.type, reply)
      if (!type) return
      const ctx: PathContext = { shipProjectPath: ship.projectPath }
      const source = scanScopeType('ship', type, ctx).find((e) => e.data.name === req.params.name)
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
      const source = scanScopeType('global', type, ctx).find((e) => e.data.name === req.params.name)
      if (!source) return reply.code(404).send({ error: 'tool not found in global scope' })
      try {
        const { targetPath } = forkTool(source, ctx)
        return { ok: true, path: targetPath }
      } catch (e) {
        return apiError(reply, 500, 'failed to fork tool', e)
      }
    },
  )

  // -------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------
  function emitRunEvent(ev: RunEvent) {
    if (!activeRun) return
    switch (ev.type) {
      case 'run:started':
        activeRun.nodeIds = ev.nodeIds
        for (const id of ev.nodeIds) activeRun.nodeStates[id] = 'pending'
        break
      case 'node:started':
        activeRun.nodeStates[ev.nodeId] = 'running'
        break
      case 'node:complete':
        activeRun.nodeStates[ev.nodeId] = 'complete'
        activeRun.nodeSummaries[ev.nodeId] = ev.summary
        break
      case 'run:complete':
        activeRun.finalSummary = ev.finalSummary
        break
      case 'run:failed':
        if (ev.nodeId) activeRun.nodeStates[ev.nodeId] = 'failed'
        activeRun.error = ev.error
        break
    }
    io.emit(ev.type, ev)
  }

  app.post<{ Body: { workflowId?: number; task?: string } }>('/api/runs', async (req, reply) => {
    const body = req.body ?? {}
    const wfId = body.workflowId ?? listWorkflows()[0]?.id
    if (typeof wfId !== 'number') {
      return reply.code(400).send({ error: 'No workflow available' })
    }
    const wf = getWorkflow(wfId)
    if (!wf) return reply.code(404).send({ error: 'workflow not found' })
    const task = body.task?.trim()
    if (!task) return reply.code(400).send({ error: 'task is required' })

    if (activeRun && !activeRun.finalSummary && !activeRun.error) {
      return reply.code(409).send({ error: 'A run is already in flight; reset first.' })
    }

    activeRun = {
      runId: '(pending)',
      task,
      nodeIds: [],
      nodeStates: {},
      nodeSummaries: {},
    }
    const controller = new AbortController()
    activeRunController = controller

    const runPromise = runWorkflowOnSessions({
      workflow: wf,
      task,
      manager,
      ctx: { shipProjectPath: null }, // ship-less run (legacy /api/runs path)
      signal: controller.signal,
      emit: (ev) => {
        if (activeRun) activeRun.runId = ev.runId
        emitRunEvent(ev)
      },
    }).catch((err) => {
      app.log.error({ err }, 'workflow run failed')
      if (activeRun) activeRun.error = err instanceof Error ? err.message : String(err)
      return null
    })
    activeRunPromise = runPromise
    // Clear the lifecycle handles when the run settles so reset doesn't await
    // a finished promise unnecessarily (and so a stale signal isn't reused).
    runPromise.finally(() => {
      if (activeRunPromise === runPromise) activeRunPromise = null
      if (activeRunController === controller) activeRunController = null
    })

    const runId = await runPromise

    return { ok: true, runId: runId ?? activeRun.runId }
  })

  app.post('/api/runs/reset', async () => {
    // Signal abort first so the executor + AI gate + script spawns cooperate
    // with the teardown instead of being killed mid-await.
    activeRunController?.abort()
    const pending = activeRunPromise
    if (pending) {
      try {
        await pending
      } catch {
        // run rejected — fine, we're tearing down
      }
    }
    await manager.destroyAll()
    transcripts.clear()
    pendingByAgent.clear()
    states.clear()
    activeRun = null
    activeRunController = null
    activeRunPromise = null
    activeFeatureId = null
    return { ok: true }
  })

  // -------------------------------------------------------------------
  // Sandbox test runs — isolated worktree + isolated SessionManager.
  // No DB persistence. Tears down on completion / failure / abort.
  // -------------------------------------------------------------------
  app.post<{
    Body: {
      shipId?: number
      workflowId?: number
      task?: string
      scope?: 'workflow' | 'node'
      nodeId?: string
      upstreamOutputs?: string
    }
  }>('/api/test-runs', async (req, reply) => {
    const { shipId, workflowId, task, scope, nodeId, upstreamOutputs } = req.body ?? {}
    if (typeof shipId !== 'number') return reply.code(400).send({ error: 'shipId is required' })
    if (typeof workflowId !== 'number')
      return reply.code(400).send({ error: 'workflowId is required' })
    if (typeof task !== 'string' || task.trim().length === 0)
      return reply.code(400).send({ error: 'task is required' })
    if (scope !== 'workflow' && scope !== 'node')
      return reply.code(400).send({ error: "scope must be 'workflow' or 'node'" })
    if (scope === 'node' && (typeof nodeId !== 'string' || nodeId.length === 0))
      return reply.code(400).send({ error: 'nodeId is required for scope=node' })

    const ship = getShip(shipId)
    if (!ship) return reply.code(404).send({ error: 'ship not found' })
    const wf = getWorkflow(workflowId)
    if (!wf) return reply.code(404).send({ error: 'workflow not found' })

    try {
      const testRunId = await testRuns.start({
        ship,
        workflow: wf,
        task,
        scope,
        nodeId,
        upstreamOutputs,
      })
      return { ok: true, testRunId }
    } catch (err) {
      return apiError(reply, 500, 'failed to start test run', err)
    }
  })

  app.post<{ Params: { id: string } }>('/api/test-runs/:id/abort', async (req) => {
    await testRuns.abort(req.params.id)
    return { ok: true }
  })

  // -------------------------------------------------------------------
  // Ships
  // -------------------------------------------------------------------
  app.get('/api/ships', async () => listShips())

  app.get<{ Params: { id: string } }>('/api/ships/:id', async (req, reply) => {
    const ship = getShip(Number(req.params.id))
    if (!ship) return reply.code(404).send({ error: 'not found' })
    return ship
  })

  app.post<{ Body: { name?: string; projectPath?: string; workflowId?: number } }>(
    '/api/ships',
    async (req, reply) => {
      try {
        const ship = await createShip({
          name: req.body.name ?? '',
          projectPath: req.body.projectPath ?? '',
          workflowId: req.body.workflowId,
        })
        io.emit('ship:created', ship)
        return ship
      } catch (e) {
        // createShip throws validation errors with messages intended for the user
        // (e.g. "Project path does not exist: ..."). Pass them through but still log.
        const publicMessage = e instanceof Error ? e.message : 'invalid ship config'
        return apiError(reply, 400, publicMessage, e)
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/api/ships/:id', async (req) => {
    deleteShip(Number(req.params.id))
    io.emit('ship:deleted', { id: Number(req.params.id) })
    return { ok: true }
  })

  // -------------------------------------------------------------------
  // Ship metadata: description (README), tools (CLIs + MCPs)
  // -------------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/ships/:id/description', async (req, reply) => {
    const ship = getShip(Number(req.params.id))
    if (!ship) return reply.code(404).send({ error: 'ship not found' })

    const pathExists = existsSync(ship.projectPath)
    let readme: string | null = null
    let readmePath: string | null = null
    if (pathExists) {
      for (const candidate of ['README.md', 'README', 'README.txt', 'Readme.md']) {
        const p = path.join(ship.projectPath, candidate)
        if (existsSync(p)) {
          try {
            readme = readFileSync(p, 'utf8')
            readmePath = candidate
            break
          } catch {
            // ignore
          }
        }
      }
    }

    let git: { branch?: string; head?: { sha: string; subject: string } } = {}
    if (pathExists) {
      try {
        const g = simpleGit(ship.projectPath)
        if (await g.checkIsRepo()) {
          const branch = (await g.revparse(['--abbrev-ref', 'HEAD'])).trim()
          const log = await g.log({ maxCount: 1 }).catch(() => null)
          git = {
            branch,
            head: log?.latest ? { sha: log.latest.hash.slice(0, 7), subject: log.latest.message } : undefined,
          }
        }
      } catch {
        // ignore
      }
    }

    return { readme, readmePath, git, projectPath: ship.projectPath, pathExists }
  })

  app.get('/api/mcp/servers', async () => {
    const db = getDb()
    const rows = db.prepare('SELECT id, name, config_json, enabled FROM mcp_servers ORDER BY name').all() as Array<{
      id: number
      name: string
      config_json: string
      enabled: number
    }>
    return rows.map((r) => {
      let config: unknown = null
      try {
        config = JSON.parse(r.config_json)
      } catch {
        // ignore
      }
      return { id: r.id, name: r.name, enabled: r.enabled === 1, config }
    })
  })

  // Curated CLIs that drones could plausibly call via Bash.
  const CLI_PROBES: Array<{ name: string; args: string[] }> = [
    { name: 'git', args: ['--version'] },
    { name: 'gh', args: ['--version'] },
    { name: 'node', args: ['--version'] },
    { name: 'npm', args: ['--version'] },
    { name: 'pnpm', args: ['--version'] },
    { name: 'python', args: ['--version'] },
    { name: 'docker', args: ['--version'] },
    { name: 'claude', args: ['--version'] },
  ]

  app.get('/api/clis', async () => {
    const results = await Promise.all(
      CLI_PROBES.map(async (probe) => {
        try {
          const { stdout, stderr } = await execFileP(probe.name, probe.args, {
            timeout: 3000,
            windowsHide: true,
          })
          const out = (stdout || stderr || '').split(/\r?\n/)[0]?.trim() ?? ''
          return { name: probe.name, available: true, version: out }
        } catch {
          return { name: probe.name, available: false, version: null }
        }
      }),
    )
    return results
  })

  // -------------------------------------------------------------------
  // Features
  // -------------------------------------------------------------------
  let activeFeatureId: number | null = null

  app.get<{ Params: { id: string } }>('/api/ships/:id/features', async (req, reply) => {
    const ship = getShip(Number(req.params.id))
    if (!ship) return reply.code(404).send({ error: 'ship not found' })
    return listFeatures(ship.id)
  })

  app.get<{ Params: { id: string } }>('/api/features/:id', async (req, reply) => {
    const feature = getFeature(Number(req.params.id))
    if (!feature) return reply.code(404).send({ error: 'not found' })
    return feature
  })

  app.post<{
    Params: { id: string }
    Body: { name?: string; task?: string; workflowId?: number }
  }>('/api/ships/:id/features', async (req, reply) => {
    const ship = getShip(Number(req.params.id))
    if (!ship) return reply.code(404).send({ error: 'ship not found' })
    const task = req.body.task?.trim()
    if (!task) return reply.code(400).send({ error: 'task required' })

    if (activeFeatureId !== null) {
      const existing = getFeature(activeFeatureId)
      if (existing && existing.status === 'running') {
        return reply.code(409).send({ error: 'a feature is already running; reset first' })
      }
    }

    const workflowId = req.body.workflowId ?? ship.workflowId ?? listWorkflows()[0]?.id
    if (typeof workflowId !== 'number') {
      return reply.code(400).send({ error: 'no workflow available' })
    }
    const wf = getWorkflow(workflowId)
    if (!wf) return reply.code(404).send({ error: 'workflow not found' })

    const name = req.body.name?.trim() || `feature-${Date.now()}`
    let feature: Feature = createFeature({ shipId: ship.id, name, task, workflowId })
    activeFeatureId = feature.id
    io.emit('feature:created', feature)

    // Create the worktree.
    let cwd: string | undefined
    try {
      const wt = await createFeatureWorktree({
        shipPath: ship.projectPath,
        featureId: feature.id,
        featureName: feature.name,
      })
      cwd = wt.path
      feature = updateFeature(feature.id, {
        branch: wt.branch,
        worktreePath: wt.path,
        status: 'running',
      })!
      io.emit('feature:updated', feature)
    } catch (e) {
      // Persist the raw error onto the feature row so the UI can display it;
      // the HTTP response stays generic since it may contain internal paths.
      const internalMsg = e instanceof Error ? e.message : String(e)
      feature = updateFeature(feature.id, { status: 'failed', error: internalMsg })!
      io.emit('feature:updated', feature)
      return apiError(reply, 500, 'worktree creation failed', e)
    }

    activeRun = {
      runId: '(pending)',
      task,
      nodeIds: [],
      nodeStates: {},
      nodeSummaries: {},
    }
    const controller = new AbortController()
    activeRunController = controller

    const runPromise = runWorkflowOnSessions({
      workflow: wf,
      task,
      manager,
      ctx: { shipProjectPath: ship.projectPath },
      cwd,
      signal: controller.signal,
      emit: (ev) => {
        if (activeRun) activeRun.runId = ev.runId
        emitRunEvent(ev)
        if (ev.type === 'run:complete') {
          const updated = updateFeature(feature.id, {
            status: 'complete',
            finalSummary: ev.finalSummary,
          })
          if (updated) io.emit('feature:updated', updated)
        } else if (ev.type === 'run:failed') {
          const updated = updateFeature(feature.id, {
            status: 'failed',
            error: ev.error,
          })
          if (updated) io.emit('feature:updated', updated)
        }
      },
    }).catch((err) => {
      app.log.error({ err }, 'feature run failed')
      const updated = updateFeature(feature.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
      if (updated) io.emit('feature:updated', updated)
    })
    activeRunPromise = runPromise
    runPromise.finally(() => {
      if (activeRunPromise === runPromise) activeRunPromise = null
      if (activeRunController === controller) activeRunController = null
    })

    return { ok: true, feature }
  })

  app.post<{ Params: { id: string } }>('/api/features/:id/teardown', async (req) => {
    const feature = getFeature(Number(req.params.id))
    if (!feature) return { ok: false }
    if (feature.worktreePath) {
      const ship = getShip(feature.shipId)
      if (ship) await removeFeatureWorktree(ship.projectPath, feature.worktreePath)
    }
    return { ok: true }
  })

  const address = await app.listen({ port: opts.port, host: '127.0.0.1' })

  /**
   * Tear the server down deterministically on SIGINT/SIGTERM:
   *   1. abort any in-flight run (executor + scripts + AI gate stop cleanly)
   *   2. abort all sandbox test runs (kills sessions, removes worktrees)
   *   3. close all live sessions
   *   4. close the HTTP server
   *   5. close the SQLite handle (flushes WAL)
   * All steps are best-effort; we never rethrow during shutdown.
   */
  async function shutdown(): Promise<void> {
    try {
      activeRunController?.abort()
      if (activeRunPromise) {
        try {
          await activeRunPromise
        } catch {
          // run rejected on abort — expected
        }
      }
    } catch (err) {
      app.log.error({ err }, 'shutdown: abort active run')
    }
    try {
      await testRuns.abortAll()
    } catch (err) {
      app.log.error({ err }, 'shutdown: abort test runs')
    }
    try {
      await manager.destroyAll()
    } catch (err) {
      app.log.error({ err }, 'shutdown: destroy sessions')
    }
    try {
      await app.close()
    } catch (err) {
      app.log.error({ err }, 'shutdown: close fastify')
    }
    try {
      closeDb()
    } catch (err) {
      app.log.error({ err }, 'shutdown: close db')
    }
  }

  return { app, io, address, manager, shutdown }
}
