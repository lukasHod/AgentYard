import Fastify, { type FastifyReply } from 'fastify'
import fastifyStatic from '@fastify/static'
import { Server as IOServer } from 'socket.io'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { closeDb, getDb } from './db.js'
import { SessionManager } from './runtime/SessionManager.js'
import type { SessionEvent } from './runtime/Session.js'
import type { SessionDescriptor } from './runtime/SessionManager.js'
import { TestRunRegistry } from './runtime/testRun.js'
import { loadSecrets } from './secrets.js'
import { seedDefaultAgentsIfMissing } from './agentsSeed.js'
import { seedDefaultScriptsIfMissing } from './scriptsSeed.js'
import { ensureDefaultWorkflow } from './workflows.js'
import { RunRegistry } from './runState.js'
import { TranscriptStore } from './transcriptStore.js'
import { wireSocketHandlers } from './socketHandlers.js'
import { registerFeatureRoutes } from './routes/features.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerRunRoutes } from './routes/runs.js'
import { registerShipRoutes } from './routes/ships.js'
import { registerTestRunRoutes } from './routes/testRuns.js'
import { registerToolRoutes } from './routes/tools.js'
import { registerWorkflowRoutes } from './routes/workflows.js'
import type { AppContext } from './routes/context.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export interface ServerOptions {
  port: number
  dev: boolean
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
  ensureDefaultWorkflow()
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

  /**
   * Send a sanitized error response. The full error (with stack + internal
   * paths) goes to the server log; the client only sees `publicMessage`.
   * Use this in every catch that builds a reply — never echo `err.message`
   * directly to the client.
   */
  function apiError(reply: FastifyReply, code: number, publicMessage: string, err?: unknown) {
    if (err !== undefined) {
      app.log.error({ err, status: code, publicMessage }, 'api error')
    } else {
      app.log.warn({ status: code, publicMessage }, 'api error')
    }
    return reply.code(code).send({ error: publicMessage })
  }

  const manager = new SessionManager()
  const io = new IOServer(app.server, {
    // In dev the UI is served by Vite on a different origin and needs CORS allow.
    // In prod the UI is served from the same Fastify origin, so refuse cross-origin
    // sockets — closes DNS-rebinding / cross-site Socket.IO connection vectors.
    cors: opts.dev ? { origin: 'http://localhost:5173' } : { origin: false },
  })
  const transcripts = new TranscriptStore(io)
  const runState = new RunRegistry(io)
  const testRuns = new TestRunRegistry(io)

  manager.on('session:added', (desc: SessionDescriptor) => transcripts.onSessionAdded(desc))
  manager.on('session:removed', (ev: { id: string }) => transcripts.onSessionRemoved(ev))
  manager.on('event', (ev: SessionEvent) => {
    if (ev.type === 'closed') app.log.info(`Session ${ev.agentRunId} closed`)
    transcripts.onSessionEvent(ev)
  })

  const ctx: AppContext = { app, io, manager, testRuns, runState, transcripts, apiError }
  wireSocketHandlers(ctx)
  registerHealthRoutes(ctx)
  registerWorkflowRoutes(ctx)
  registerToolRoutes(ctx)
  registerRunRoutes(ctx)
  registerTestRunRoutes(ctx)
  registerShipRoutes(ctx)
  registerFeatureRoutes(ctx)

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
      await runState.abort()
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
