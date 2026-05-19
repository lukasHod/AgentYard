import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { Server as IOServer, type Socket } from 'socket.io'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { getDb } from './db.js'
import { Session, type SessionEvent } from './runtime/Session.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export interface ServerOptions {
  port: number
  dev: boolean
}

// Phase 1: a single global session. Phase 2 introduces SessionManager.
const PHASE1_AGENT_RUN_ID = 1

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

  const io = new IOServer(app.server, {
    cors: opts.dev ? { origin: 'http://localhost:5173' } : undefined,
  })

  // Single global Session for Phase 1.
  const session = new Session()
  session.start()
  app.log.info('Agent session started')

  // Snapshot of session history so newly-connected clients can catch up.
  const transcript: Array<{ role: 'assistant' | 'user' | 'system'; content: string; timestamp: number }> = []
  const pendingClarifications = new Map<string, { id: string; question: string }>()
  let lastState = session.state

  session.on('event', (ev: SessionEvent) => {
    switch (ev.type) {
      case 'message': {
        transcript.push({
          role: ev.message.role,
          content: ev.message.text,
          timestamp: ev.message.timestamp,
        })
        io.emit('agent:message', {
          agentRunId: PHASE1_AGENT_RUN_ID,
          role: ev.message.role,
          content: ev.message.text,
          timestamp: ev.message.timestamp,
        })
        break
      }
      case 'state': {
        lastState = ev.state
        io.emit('agent:state', { agentRunId: PHASE1_AGENT_RUN_ID, state: ev.state })
        break
      }
      case 'clarification:requested': {
        pendingClarifications.set(ev.req.id, ev.req)
        io.emit('clarification:requested', {
          agentRunId: PHASE1_AGENT_RUN_ID,
          toolUseId: ev.req.id,
          question: ev.req.question,
        })
        break
      }
      case 'clarification:resolved': {
        pendingClarifications.delete(ev.id)
        io.emit('clarification:resolved', {
          agentRunId: PHASE1_AGENT_RUN_ID,
          toolUseId: ev.id,
        })
        break
      }
      case 'closed': {
        app.log.warn('Agent session closed')
        break
      }
    }
  })

  io.on('connection', (socket: Socket) => {
    app.log.info(`socket connected: ${socket.id}`)

    // Replay current state to the new connection.
    for (const m of transcript) {
      socket.emit('agent:message', {
        agentRunId: PHASE1_AGENT_RUN_ID,
        ...m,
      })
    }
    socket.emit('agent:state', { agentRunId: PHASE1_AGENT_RUN_ID, state: lastState })
    for (const c of pendingClarifications.values()) {
      socket.emit('clarification:requested', {
        agentRunId: PHASE1_AGENT_RUN_ID,
        toolUseId: c.id,
        question: c.question,
      })
    }

    socket.on('agent:send', (payload: { content: string }) => {
      if (typeof payload?.content !== 'string' || payload.content.length === 0) return
      session.sendUserMessage(payload.content)
    })

    socket.on('clarification:reply', (payload: { toolUseId: string; answer: string }) => {
      if (!payload?.toolUseId || typeof payload.answer !== 'string') return
      session.resolveClarification(payload.toolUseId, payload.answer)
    })

    socket.on('disconnect', (reason) => {
      app.log.info(`socket disconnected: ${socket.id} (${reason})`)
    })
  })

  const address = await app.listen({ port: opts.port, host: '127.0.0.1' })
  return { app, io, address, session }
}
