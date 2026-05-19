import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { Server as IOServer } from 'socket.io'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { getDb } from './db.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export interface ServerOptions {
  port: number
  dev: boolean
}

export async function startServer(opts: ServerOptions) {
  // Touch the database to surface schema errors early.
  getDb()

  const app = Fastify({ logger: true })

  // In dev, Vite serves the client on its own port; the server just exposes
  // API + Socket.IO. In prod, the server serves the prebuilt client.
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

  // Phase 0 sanity check: a periodic ping so we can verify the WS channel.
  let pingCount = 0
  setInterval(() => {
    pingCount++
    io.emit('ping', { count: pingCount, at: Date.now() })
  }, 2000)

  io.on('connection', (socket) => {
    app.log.info(`socket connected: ${socket.id}`)
    socket.emit('ping', { count: pingCount, at: Date.now() })
    socket.on('disconnect', (reason) => {
      app.log.info(`socket disconnected: ${socket.id} (${reason})`)
    })
  })

  const address = await app.listen({ port: opts.port, host: '127.0.0.1' })
  return { app, io, address }
}
