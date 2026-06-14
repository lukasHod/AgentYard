import { io, type Socket } from 'socket.io-client'
import type { ClientEvents, ServerEvents } from '../../core/types'
import { useSocketStore } from './socketStore'

let socket: Socket | null = null

export function initSocketClient(): Socket {
  if (socket) return socket
  socket = io({ transports: ['websocket', 'polling'] })
  const store = useSocketStore.getState()

  socket.on('connect', () => store.setConnected(true))
  socket.on('disconnect', () => store.setConnected(false))

  socket.on('session:list', (ev: ServerEvents['session:list']) => store.applySessionList(ev))
  socket.on('session:added', (ev: ServerEvents['session:added']) => store.applySessionAdded(ev))
  socket.on('session:removed', (ev: ServerEvents['session:removed']) => store.applySessionRemoved(ev))

  socket.on('agent:message', (ev: ServerEvents['agent:message']) => store.applyAgentMessage(ev))
  socket.on('agent:state', (ev: ServerEvents['agent:state']) => store.applyAgentState(ev))

  socket.on('clarification:requested', (ev: ServerEvents['clarification:requested']) =>
    store.applyClarificationRequested(ev),
  )
  socket.on('clarification:resolved', (ev: ServerEvents['clarification:resolved']) =>
    store.applyClarificationResolved(ev),
  )

  socket.on('question:list', (ev: ServerEvents['question:list']) => store.applyQuestionList(ev))
  socket.on('question:created', (ev: ServerEvents['question:created']) =>
    store.applyQuestionCreated(ev),
  )
  socket.on('question:answered', (ev: ServerEvents['question:answered']) =>
    store.applyQuestionAnswered(ev),
  )
  socket.on('question:dismissed', (ev: ServerEvents['question:dismissed']) =>
    store.applyQuestionDismissed(ev),
  )

  socket.on('run:snapshot', (ev: ServerEvents['run:snapshot']) => store.applyRunSnapshot(ev))
  socket.on('run:started', (ev: ServerEvents['run:started']) => store.applyRunStarted(ev))
  socket.on('node:started', (ev: ServerEvents['node:started']) => store.applyNodeStarted(ev))
  socket.on('node:complete', (ev: ServerEvents['node:complete']) => store.applyNodeComplete(ev))
  socket.on('run:complete', (ev: ServerEvents['run:complete']) => store.applyRunComplete(ev))
  socket.on('run:failed', (ev: ServerEvents['run:failed']) => store.applyRunFailed(ev))

  socket.on('planet:created', (ev: ServerEvents['planet:created']) => store.applyPlanetCreated(ev))
  socket.on('planet:deleted', (ev: ServerEvents['planet:deleted']) => store.applyPlanetDeleted(ev))
  socket.on('feature:created', (ev: ServerEvents['feature:created']) => store.applyFeatureCreated(ev))
  socket.on('feature:updated', (ev: ServerEvents['feature:updated']) => store.applyFeatureUpdated(ev))
  socket.on('feature:deleted', (ev: ServerEvents['feature:deleted']) => store.applyFeatureDeleted(ev.id))

  socket.on('review-loop:list', (ev: ServerEvents['review-loop:list']) =>
    store.applyReviewLoopList(ev),
  )
  socket.on('review-loop:update', (ev: ServerEvents['review-loop:update']) =>
    store.applyReviewLoopUpdate(ev),
  )

  socket.on('terminal:list', (ev: ServerEvents['terminal:list']) => store.applyTerminalList(ev))
  socket.on('terminal:session:added', (ev: ServerEvents['terminal:session:added']) =>
    store.applyTerminalAdded(ev),
  )
  socket.on('terminal:session:update', (ev: ServerEvents['terminal:session:update']) =>
    store.applyTerminalUpdate(ev),
  )
  socket.on('terminal:session:removed', (ev: ServerEvents['terminal:session:removed']) =>
    store.applyTerminalRemoved(ev),
  )
  socket.on('terminal:data', (ev: ServerEvents['terminal:data']) => store.applyTerminalData(ev))
  socket.on('terminal:snapshot', (ev: ServerEvents['terminal:snapshot']) =>
    store.applyTerminalSnapshot(ev),
  )
  socket.on('terminal:exit', (ev: ServerEvents['terminal:exit']) => store.applyTerminalExit(ev))

  return socket
}

export function getSocket(): Socket | null {
  return socket
}

export function sendAgentMessage(agentRunId: string, content: string) {
  if (socket) {
    socket.emit('agent:send', { agentRunId, content })
    return
  }
  // No socket → mock/offline mode. Push the user message straight into the
  // transcript so the chat UI is exercisable without a backend.
  useSocketStore.getState().applyAgentMessage({
    agentRunId,
    role: 'user',
    content,
    timestamp: Date.now(),
  })
}

export function replyClarification(agentRunId: string, toolUseId: string, answer: string) {
  if (socket) {
    socket.emit('clarification:reply', { agentRunId, toolUseId, answer })
    return
  }
  const store = useSocketStore.getState()
  store.applyAgentMessage({
    agentRunId,
    role: 'user',
    content: answer,
    timestamp: Date.now(),
  })
  store.applyClarificationResolved({ agentRunId, toolUseId })
}

// ── Terminals ─────────────────────────────────────────────────────────────

export function startTerminal(req: ClientEvents['terminal:start']) {
  socket?.emit('terminal:start', req)
}

export function attachTerminal(sessionId: string) {
  socket?.emit('terminal:attach', { sessionId })
}

export function detachTerminal(sessionId: string) {
  socket?.emit('terminal:detach', { sessionId })
}

export function sendTerminalInput(sessionId: string, data: string) {
  socket?.emit('terminal:input', { sessionId, data })
}

export function resizeTerminal(sessionId: string, cols: number, rows: number) {
  socket?.emit('terminal:resize', { sessionId, cols, rows })
}

export function killTerminal(sessionId: string) {
  socket?.emit('terminal:kill', { sessionId })
}

export function restartTerminal(sessionId: string) {
  socket?.emit('terminal:restart', { sessionId })
}

export function resumeTerminal(sessionId: string) {
  socket?.emit('terminal:resume', { sessionId })
}

export function openShellFromTerminal(sessionId: string) {
  socket?.emit('terminal:open-shell', { sessionId })
}

export function restartTerminalWithContext(sessionId: string, markdown: string) {
  socket?.emit('terminal:restart-with-context', { sessionId, markdown })
}

/**
 * Kills the PTY (if alive) AND removes the descriptor row from the DB. Use
 * for "remove from UI" affordances. Server broadcasts `terminal:session:removed`.
 */
export function deleteTerminal(sessionId: string) {
  useSocketStore.getState().applyTerminalRemoved({ sessionId })
  socket?.emit('terminal:delete', { sessionId })
}

// ── Review loop manual overrides ─────────────────────────────────────────────

export function forceCompleteReviewLoop(loopRunId: string) {
  socket?.emit('review-loop:force-complete', { loopRunId })
}

export function forceNextReviewIteration(loopRunId: string) {
  socket?.emit('review-loop:force-next-iteration', { loopRunId })
}

// ── Pending questions ──────────────────────────────────────────────────────

export function answerQuestion(questionId: string, answer: string) {
  socket?.emit('question:answer', { questionId, answer })
}

export function dismissQuestion(questionId: string) {
  socket?.emit('question:dismiss', { questionId })
}
