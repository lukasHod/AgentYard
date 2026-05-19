import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { Server as IOServer, type Socket } from 'socket.io'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { getDb } from './db.js'
import { SessionManager, type SessionDescriptor } from './runtime/SessionManager.js'
import type { Session, SessionEvent } from './runtime/Session.js'
import { runWorkflowOnSessions } from './runtime/runWorkflowOnSessions.js'
import {
  ensureDefaultWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflow,
} from './workflows.js'
import { getLoadedSkills, scanSkills } from './skills.js'
import { createShip, deleteShip, getShip, listShips } from './ships.js'
import { createFeature, getFeature, listFeatures, updateFeature, type Feature } from './features.js'
import { createFeatureWorktree, removeFeatureWorktree } from './runtime/worktrees.js'
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
  ensureDefaultWorkflow()
  scanSkills()

  const app = Fastify({ logger: true })

  if (!opts.dev) {
    const publicDir = path.resolve(here, '../public')
    if (existsSync(publicDir)) {
      await app.register(fastifyStatic, { root: publicDir })
    }
  }

  app.get('/api/health', async () => ({ ok: true, version: '0.0.1' }))

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

  const io = new IOServer(app.server, {
    cors: opts.dev ? { origin: 'http://localhost:5173' } : undefined,
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
  // Skills
  // -------------------------------------------------------------------
  app.get('/api/skills', async () =>
    getLoadedSkills().map((s) => ({ name: s.name, description: s.description, path: s.path })),
  )

  app.post('/api/skills/refresh', async () => {
    const skills = scanSkills()
    return skills.map((s) => ({ name: s.name, description: s.description, path: s.path }))
  })

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

    // Run asynchronously — respond immediately with the runId once the
    // executor emits run:started. We do that synchronously here by
    // capturing the runId before awaiting completion.
    const runId = await runWorkflowOnSessions({
      workflow: wf,
      task,
      manager,
      emit: (ev) => {
        if (activeRun) activeRun.runId = ev.runId
        emitRunEvent(ev)
      },
    }).catch((err) => {
      app.log.error({ err }, 'workflow run failed')
      if (activeRun) activeRun.error = err instanceof Error ? err.message : String(err)
      return null
    })

    return { ok: true, runId: runId ?? activeRun.runId }
  })

  app.post('/api/runs/reset', async () => {
    await manager.destroyAll()
    transcripts.clear()
    pendingByAgent.clear()
    states.clear()
    activeRun = null
    activeFeatureId = null
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
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) })
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/api/ships/:id', async (req) => {
    deleteShip(Number(req.params.id))
    io.emit('ship:deleted', { id: Number(req.params.id) })
    return { ok: true }
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
      const msg = e instanceof Error ? e.message : String(e)
      feature = updateFeature(feature.id, { status: 'failed', error: msg })!
      io.emit('feature:updated', feature)
      return reply.code(500).send({ error: `worktree creation failed: ${msg}` })
    }

    activeRun = {
      runId: '(pending)',
      task,
      nodeIds: [],
      nodeStates: {},
      nodeSummaries: {},
    }

    // Run asynchronously — return immediately.
    runWorkflowOnSessions({
      workflow: wf,
      task,
      manager,
      cwd,
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
  return { app, io, address, manager }
}
