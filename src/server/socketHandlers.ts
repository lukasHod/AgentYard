import type { FastifyInstance } from 'fastify'
import type { ClientEvents } from '../core/types.js'
import type { SessionManager } from './runtime/SessionManager.js'
import type { TestRunRegistry } from './runtime/testRun.js'
import type { RunRegistry } from './runState.js'
import type { PlanetChatRegistry } from './planetChat.js'
import type { TranscriptStore } from './transcriptStore.js'
import type { TypedIOServer, TypedSocket } from './socketTypes.js'

export interface WireSocketDeps {
  app: FastifyInstance
  io: TypedIOServer
  manager: SessionManager
  testRuns: TestRunRegistry
  runState: RunRegistry
  transcripts: TranscriptStore
  planetChats: PlanetChatRegistry
}

/**
 * Wire Socket.IO connection handling: on every new connection, replay the
 * session list, transcript history, latest agent states, outstanding
 * clarifications, and the active run snapshot — so a freshly opened tab
 * sees the world as it is. Inbound events (agent:send, clarification:reply,
 * test-run:*) get forwarded to the SessionManager / TestRunRegistry.
 */
export function wireSocketHandlers(deps: WireSocketDeps): void {
  const { app, io, manager, testRuns, runState, transcripts, planetChats } = deps

  // socket.io's typed-event generics give us static event names / payload
  // shapes (see socketTypes.ts), but the wire is still untrusted at runtime
  // — keep the typeof guards so a malformed client can't crash a handler.
  io.on('connection', (socket: TypedSocket) => {
    app.log.info(`socket connected: ${socket.id}`)

    socket.emit('session:list', manager.describeAll())
    transcripts.catchUp(socket)
    planetChats.catchUpSocket(socket)
    const snapshot = runState.snapshot()
    if (snapshot) socket.emit('run:snapshot', snapshot)

    socket.on('agent:send', (payload: ClientEvents['agent:send']) => {
      if (typeof payload?.agentRunId !== 'string' || typeof payload?.content !== 'string') return
      if (payload.content.length === 0) return
      manager.get(payload.agentRunId)?.sendUserMessage(payload.content)
    })

    socket.on('clarification:reply', (payload: ClientEvents['clarification:reply']) => {
      if (!payload?.agentRunId || !payload?.toolUseId || typeof payload.answer !== 'string') return
      manager.get(payload.agentRunId)?.resolveClarification(payload.toolUseId, payload.answer)
    })

    socket.on('test-run:agent:send', (payload: ClientEvents['test-run:agent:send']) => {
      if (
        typeof payload?.testRunId !== 'string' ||
        typeof payload?.agentRunId !== 'string' ||
        typeof payload?.content !== 'string'
      )
        return
      if (payload.content.length === 0) return
      testRuns.sendToAgent(payload.testRunId, payload.agentRunId, payload.content)
    })

    socket.on(
      'test-run:clarification:reply',
      (payload: ClientEvents['test-run:clarification:reply']) => {
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
}
