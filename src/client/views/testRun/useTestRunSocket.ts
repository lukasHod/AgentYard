import { useEffect, useState } from 'react'
import type { Socket } from 'socket.io-client'
import type {
  AgentState,
  ServerEvents,
  SessionDescriptor,
} from '../../../core/types'
import type { WorkflowNode } from '../../../core/schema'

export interface ChatMessage {
  id: string
  role: 'assistant' | 'user' | 'system'
  content: string
  timestamp: number
}

export interface NodeProgressEntry {
  nodeId: string
  title: string
  status: 'started' | 'complete' | 'skipped' | 'failed'
  summary?: string
  timestamp: number
}

export interface PendingClarification {
  toolUseId: string
  question: string
}

export type TestRunStage = 'form' | 'running' | 'done' | 'failed' | 'aborted'

let msgCounter = 0
const nextMsgId = () => `m${++msgCounter}`

interface UseTestRunSocketArgs {
  socket: Socket | null
  testRunId: string | null
  customNodes: Map<string, WorkflowNode>
}

interface UseTestRunSocketReturn {
  stage: TestRunStage
  setStage: React.Dispatch<React.SetStateAction<TestRunStage>>
  sessions: SessionDescriptor[]
  transcripts: Map<string, ChatMessage[]>
  pendings: Map<string, PendingClarification>
  nodeProgress: NodeProgressEntry[]
  scriptOutputs: Map<string, string>
  finalSummary: string | null
  error: string | null
}

/**
 * Wires the 13 `test-run:*` socket events to local state for a single
 * test run. Filters by testRunId so multiple modals (or stale runs) never
 * cross-contaminate. Cleans up listeners on unmount or when testRunId changes.
 */
export function useTestRunSocket({
  socket,
  testRunId,
  customNodes,
}: UseTestRunSocketArgs): UseTestRunSocketReturn {
  const [stage, setStage] = useState<TestRunStage>('form')
  const [sessions, setSessions] = useState<SessionDescriptor[]>([])
  const [transcripts, setTranscripts] = useState<Map<string, ChatMessage[]>>(new Map())
  const [pendings, setPendings] = useState<Map<string, PendingClarification>>(new Map())
  const [nodeProgress, setNodeProgress] = useState<NodeProgressEntry[]>([])
  const [scriptOutputs, setScriptOutputs] = useState<Map<string, string>>(new Map())
  const [finalSummary, setFinalSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!socket || !testRunId) return
    const matches = (ev: { testRunId: string }) => ev.testRunId === testRunId

    const onStarted = (ev: ServerEvents['test-run:started']) => {
      if (!matches(ev)) return
      setStage('running')
    }
    const onComplete = (ev: ServerEvents['test-run:complete']) => {
      if (!matches(ev)) return
      setStage('done')
      setFinalSummary(ev.finalSummary)
    }
    const onFailed = (ev: ServerEvents['test-run:failed']) => {
      if (!matches(ev)) return
      setStage((s) => (s === 'aborted' ? s : 'failed'))
      setError(ev.error)
    }
    const onNodeStarted = (ev: ServerEvents['test-run:node:started']) => {
      if (!matches(ev)) return
      setNodeProgress((p) => [
        ...p,
        { nodeId: ev.nodeId, title: ev.title, status: 'started', timestamp: Date.now() },
      ])
    }
    const onNodeComplete = (ev: ServerEvents['test-run:node:complete']) => {
      if (!matches(ev)) return
      setNodeProgress((p) => [
        ...p,
        {
          nodeId: ev.nodeId,
          title: ev.title,
          status: 'complete',
          summary: ev.summary,
          timestamp: Date.now(),
        },
      ])
      if (customNodes.has(ev.nodeId)) {
        setScriptOutputs((m) => new Map(m).set(ev.nodeId, ev.summary))
      }
    }
    const onNodeSkipped = (ev: ServerEvents['test-run:node:skipped']) => {
      if (!matches(ev)) return
      setNodeProgress((p) => [
        ...p,
        { nodeId: ev.nodeId, title: ev.title, status: 'skipped', timestamp: Date.now() },
      ])
    }
    const onSessionAdded = (ev: ServerEvents['test-run:session:added']) => {
      if (!matches(ev)) return
      setSessions((sx) => [...sx, ev.descriptor])
      setTranscripts((t) => {
        const next = new Map(t)
        next.set(ev.descriptor.id, [])
        return next
      })
      setPendings((p) => {
        if (!p.has(ev.descriptor.id)) return p
        const next = new Map(p)
        next.delete(ev.descriptor.id)
        return next
      })
    }
    const onSessionRemoved = (ev: ServerEvents['test-run:session:removed']) => {
      if (!matches(ev)) return
      setSessions((sx) =>
        sx.map((s) => (s.id === ev.id ? { ...s, state: 'done' as AgentState } : s)),
      )
    }
    const onMessage = (ev: ServerEvents['test-run:agent:message']) => {
      if (!matches(ev)) return
      setTranscripts((t) => {
        const next = new Map(t)
        const cur = next.get(ev.agentRunId) ?? []
        next.set(ev.agentRunId, [
          ...cur,
          { id: nextMsgId(), role: ev.role, content: ev.content, timestamp: ev.timestamp },
        ])
        return next
      })
    }
    const onState = (ev: ServerEvents['test-run:agent:state']) => {
      if (!matches(ev)) return
      setSessions((sx) =>
        sx.map((s) => (s.id === ev.agentRunId ? { ...s, state: ev.state } : s)),
      )
    }
    const onClarRequested = (ev: ServerEvents['test-run:clarification:requested']) => {
      if (!matches(ev)) return
      setPendings((p) =>
        new Map(p).set(ev.agentRunId, { toolUseId: ev.toolUseId, question: ev.question }),
      )
    }
    const onClarResolved = (ev: ServerEvents['test-run:clarification:resolved']) => {
      if (!matches(ev)) return
      setPendings((p) => {
        const cur = p.get(ev.agentRunId)
        if (!cur || cur.toolUseId !== ev.toolUseId) return p
        const next = new Map(p)
        next.delete(ev.agentRunId)
        return next
      })
    }
    const onTeardown = (_ev: ServerEvents['test-run:teardown']) => {
      // Server cleaned up the run — no UI action required, the stage was
      // already set by the matching complete/failed event.
    }

    socket.on('test-run:started', onStarted)
    socket.on('test-run:complete', onComplete)
    socket.on('test-run:failed', onFailed)
    socket.on('test-run:node:started', onNodeStarted)
    socket.on('test-run:node:complete', onNodeComplete)
    socket.on('test-run:node:skipped', onNodeSkipped)
    socket.on('test-run:session:added', onSessionAdded)
    socket.on('test-run:session:removed', onSessionRemoved)
    socket.on('test-run:agent:message', onMessage)
    socket.on('test-run:agent:state', onState)
    socket.on('test-run:clarification:requested', onClarRequested)
    socket.on('test-run:clarification:resolved', onClarResolved)
    socket.on('test-run:teardown', onTeardown)

    return () => {
      socket.off('test-run:started', onStarted)
      socket.off('test-run:complete', onComplete)
      socket.off('test-run:failed', onFailed)
      socket.off('test-run:node:started', onNodeStarted)
      socket.off('test-run:node:complete', onNodeComplete)
      socket.off('test-run:node:skipped', onNodeSkipped)
      socket.off('test-run:session:added', onSessionAdded)
      socket.off('test-run:session:removed', onSessionRemoved)
      socket.off('test-run:agent:message', onMessage)
      socket.off('test-run:agent:state', onState)
      socket.off('test-run:clarification:requested', onClarRequested)
      socket.off('test-run:clarification:resolved', onClarResolved)
      socket.off('test-run:teardown', onTeardown)
    }
  }, [socket, testRunId, customNodes])

  return {
    stage,
    setStage,
    sessions,
    transcripts,
    pendings,
    nodeProgress,
    scriptOutputs,
    finalSummary,
    error,
  }
}
