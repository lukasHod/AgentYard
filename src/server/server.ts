import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { Server as IOServer, type Socket } from 'socket.io'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { getDb } from './db.js'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { SessionManager, type SessionDescriptor } from './runtime/SessionManager.js'
import type { Session, SessionEvent } from './runtime/Session.js'
import { createAssignTaskTool } from './runtime/tools/assignTask.js'
import {
  createMarkNodeCompleteTool,
  type NodeCompleteOutputs,
} from './runtime/tools/markNodeComplete.js'

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

    // Replay snapshot on connect: session list, transcripts, states, pendings.
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

    socket.on('agent:send', (payload: { agentRunId: string; content: string }) => {
      if (typeof payload?.agentRunId !== 'string' || typeof payload?.content !== 'string') return
      if (payload.content.length === 0) return
      const session = manager.get(payload.agentRunId)
      if (!session) return
      session.sendUserMessage(payload.content)
    })

    socket.on(
      'clarification:reply',
      (payload: { agentRunId: string; toolUseId: string; answer: string }) => {
        if (!payload?.agentRunId || !payload?.toolUseId || typeof payload.answer !== 'string') return
        const session = manager.get(payload.agentRunId)
        if (!session) return
        session.resolveClarification(payload.toolUseId, payload.answer)
      },
    )

    socket.on('disconnect', (reason) => {
      app.log.info(`socket disconnected: ${socket.id} (${reason})`)
    })
  })

  // -------------------------------------------------------------------
  // Phase 2 develop-demo endpoint
  // -------------------------------------------------------------------
  app.post('/api/demo/develop', async (request, reply) => {
    const body = (request.body as { task?: string }) ?? {}
    const task =
      body.task?.trim() ||
      "Plan a simple 'TODO list' web component. Delegate to the implementer to describe the component structure (HTML+JS, ~5 lines), and to the tester to list 3 test cases. Then mark the node complete with a brief summary."

    // Don't spawn duplicates while a demo is in-flight.
    const existing = manager.list().filter((s) => s.opts.label === 'leader')
    if (existing.length > 0) {
      return reply.code(409).send({ error: 'Develop demo already running.' })
    }

    const droneImplementer = manager.spawn({
      role: 'drone',
      label: 'implementer',
      systemPrompt:
        'You are the IMPLEMENTER drone on a small dev team. You design and describe features in concise pseudocode/HTML when delegated to. Keep responses brief (~5 lines). If the request is ambiguous, use the request_clarification tool.',
    })

    const droneTester = manager.spawn({
      role: 'drone',
      label: 'tester',
      systemPrompt:
        'You are the TESTER drone on a small dev team. When delegated to, list concise test cases (one per line). Keep it brief. If the request is ambiguous, use the request_clarification tool.',
    })

    const onNodeComplete = (result: NodeCompleteOutputs) => {
      app.log.info({ result }, 'develop node complete')
      io.emit('node:complete', { node: 'develop', ...result })
    }

    const assignTaskTool = createAssignTaskTool({
      resolveDrone: (target) => {
        const byLabel = manager.findByLabel(target)
        if (byLabel) return byLabel
        return manager.get(target)
      },
      rosterDescription: 'implementer, tester',
    })

    const markCompleteTool = createMarkNodeCompleteTool(onNodeComplete)

    const leader = manager.spawn({
      role: 'leader',
      label: 'leader',
      systemPrompt: `You are the LEADER of a small development team running a "develop" workflow node.

Your team:
- "implementer" — a drone that writes code/designs
- "tester" — a drone that writes test cases

Use the assign_task tool to delegate work to your team — name the drone by label ("implementer" or "tester"). Each delegation blocks until the drone finishes; their response becomes your tool result.
Use mark_node_complete when you are fully done. You may use request_clarification if the user's task is ambiguous.

Keep delegations small. Do not call assign_task on yourself. Do not invent tools beyond the three you have.`,
      extraTools: [assignTaskTool, markCompleteTool] as SdkMcpToolDefinition<any>[],
    })

    // Kick off the leader.
    leader.sendUserMessage(task)

    return {
      ok: true,
      leader: leader.id,
      drones: [droneImplementer.id, droneTester.id],
    }
  })

  app.post('/api/demo/reset', async () => {
    await manager.destroyAll()
    transcripts.clear()
    pendingByAgent.clear()
    states.clear()
    return { ok: true }
  })

  const address = await app.listen({ port: opts.port, host: '127.0.0.1' })
  return { app, io, address, manager }
}
