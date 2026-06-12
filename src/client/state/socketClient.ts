import { io, type Socket } from 'socket.io-client'
import type { ServerEvents } from '../../core/types'
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
