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

  socket.on('ship:created', (ev: ServerEvents['ship:created']) => store.applyShipCreated(ev))
  socket.on('ship:deleted', (ev: ServerEvents['ship:deleted']) => store.applyShipDeleted(ev))
  socket.on('feature:created', (ev: ServerEvents['feature:created']) => store.applyFeatureCreated(ev))
  socket.on('feature:updated', (ev: ServerEvents['feature:updated']) => store.applyFeatureUpdated(ev))

  return socket
}

export function getSocket(): Socket | null {
  return socket
}

export function sendAgentMessage(agentRunId: string, content: string) {
  socket?.emit('agent:send', { agentRunId, content })
}

export function replyClarification(agentRunId: string, toolUseId: string, answer: string) {
  socket?.emit('clarification:reply', { agentRunId, toolUseId, answer })
}
