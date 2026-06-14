import type { FastifyInstance } from 'fastify'
import type { ClientEvents } from '../core/types.js'
import type { SessionManager } from './runtime/SessionManager.js'
import type { TestRunRegistry } from './runtime/testRun.js'
import type { RunRegistry } from './runState.js'
import type { PlanetChatRegistry } from './planetChat.js'
import type { FeatureChatRegistry } from './featureChat.js'
import type { TranscriptStore } from './transcriptStore.js'
import type { PendingQuestionStore } from './pendingQuestionStore.js'
import type { TerminalSessionManager } from './runtime/TerminalSessionManager.js'
import type { TypedIOServer, TypedSocket } from './socketTypes.js'

export interface WireSocketDeps {
  app: FastifyInstance
  io: TypedIOServer
  manager: SessionManager
  terminals: TerminalSessionManager
  testRuns: TestRunRegistry
  runState: RunRegistry
  transcripts: TranscriptStore
  pendingQuestions: PendingQuestionStore
  planetChats: PlanetChatRegistry
  featureChats?: FeatureChatRegistry
}

/**
 * Wire Socket.IO connection handling: on every new connection, replay the
 * session list, transcript history, latest agent states, outstanding
 * clarifications, and the active run snapshot — so a freshly opened tab
 * sees the world as it is. Inbound events (agent:send, clarification:reply,
 * test-run:*) get forwarded to the SessionManager / TestRunRegistry.
 */
export function wireSocketHandlers(deps: WireSocketDeps): void {
  const { app, io, manager, terminals, testRuns, runState, transcripts, pendingQuestions, planetChats, featureChats } = deps

  // socket.io's typed-event generics give us static event names / payload
  // shapes (see socketTypes.ts), but the wire is still untrusted at runtime
  // — keep the typeof guards so a malformed client can't crash a handler.
  io.on('connection', (socket: TypedSocket) => {
    app.log.info(`socket connected: ${socket.id}`)

    socket.emit('session:list', manager.describeAll())
    socket.emit('terminal:list', terminals.list())
    transcripts.catchUp(socket)
    pendingQuestions.catchUp(socket)
    planetChats.catchUpSocket(socket)
    featureChats?.catchUpSocket(socket)
    const snapshot = runState.snapshot()
    if (snapshot) socket.emit('run:snapshot', snapshot)
    // Phase 7: also push the full registry so dashboards can show every run.
    socket.emit('run:snapshot:list', runState.allSnapshots())

    socket.on('agent:send', (payload: ClientEvents['agent:send']) => {
      if (typeof payload?.agentRunId !== 'string' || typeof payload?.content !== 'string') return
      if (payload.content.length === 0) return
      const session = manager.get(payload.agentRunId)
      if (!session) {
        app.log.warn({ agentRunId: payload.agentRunId }, 'agent:send target session not found')
        socket.emit('agent:message', {
          agentRunId: payload.agentRunId,
          role: 'system',
          content: 'This chat session is no longer running. Reopen the chat and resend your message.',
          timestamp: Date.now(),
        })
        return
      }
      session.sendUserMessage(payload.content)
    })

    socket.on('clarification:reply', (payload: ClientEvents['clarification:reply']) => {
      if (!payload?.agentRunId || !payload?.toolUseId || typeof payload.answer !== 'string') return
      manager.get(payload.agentRunId)?.resolveClarification(payload.toolUseId, payload.answer)
    })

    socket.on('question:answer', (payload: ClientEvents['question:answer']) => {
      if (typeof payload?.questionId !== 'string' || typeof payload?.answer !== 'string') return
      const routed = pendingQuestions.answer(payload.questionId, payload.answer)
      if (!routed) {
        app.log.warn({ questionId: payload.questionId }, 'question:answer — question not found or already resolved')
      }
    })

    socket.on('question:dismiss', (payload: ClientEvents['question:dismiss']) => {
      if (typeof payload?.questionId !== 'string') return
      pendingQuestions.dismiss(payload.questionId)
    })

    socket.on('terminal:start', (payload: ClientEvents['terminal:start']) => {
      if (!payload || typeof payload.profileId !== 'string') return
      try {
        terminals.start(payload)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        app.log.warn({ err }, 'terminal:start failed')
        socket.emit('terminal:data', {
          sessionId: payload.sessionId ?? 'unknown',
          data: `\r\n[AgentYard terminal start failed] ${message}\r\n`,
          timestamp: Date.now(),
        })
      }
    })

    socket.on('terminal:attach', (payload: ClientEvents['terminal:attach']) => {
      if (typeof payload?.sessionId !== 'string') return
      const snapshot = terminals.snapshot(payload.sessionId)
      if (!snapshot) return
      socket.emit('terminal:snapshot', {
        sessionId: payload.sessionId,
        data: snapshot.data,
        state: snapshot.state,
      })
    })

    socket.on('terminal:detach', (payload: ClientEvents['terminal:detach']) => {
      if (typeof payload?.sessionId !== 'string') return
      // No server bookkeeping yet; the event exists so clients can keep a
      // symmetrical attach/detach lifecycle while terminals remain process-owned.
    })

    socket.on('terminal:input', (payload: ClientEvents['terminal:input']) => {
      if (typeof payload?.sessionId !== 'string' || typeof payload.data !== 'string') return
      terminals.write(payload.sessionId, payload.data)
    })

    socket.on('terminal:resize', (payload: ClientEvents['terminal:resize']) => {
      if (
        typeof payload?.sessionId !== 'string' ||
        typeof payload.cols !== 'number' ||
        typeof payload.rows !== 'number'
      )
        return
      terminals.resize(payload.sessionId, payload.cols, payload.rows)
    })

    socket.on('terminal:kill', (payload: ClientEvents['terminal:kill']) => {
      if (typeof payload?.sessionId !== 'string') return
      void terminals.kill(payload.sessionId)
    })

    socket.on('terminal:restart', (payload: ClientEvents['terminal:restart']) => {
      if (typeof payload?.sessionId !== 'string') return
      terminals.restart(payload.sessionId)
    })

    socket.on('terminal:delete', (payload: ClientEvents['terminal:delete']) => {
      if (typeof payload?.sessionId !== 'string') return
      void terminals.delete(payload.sessionId)
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
