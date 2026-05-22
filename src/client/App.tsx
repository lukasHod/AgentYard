import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import type {
  FeatureSummary,
  RunSnapshot,
  ServerEvents,
  SessionDescriptor,
  ShipSummary,
} from '../core/types'
import type { Workflow } from '../core/schema'
import type { ToolSummary } from '../core/tools'
import { RunView, type ChatMessage, type PendingClarification } from './views/RunView'
import { EditorView } from './views/EditorView'
import { TestRunModal, type TestRunRequest } from './views/TestRunModal'
import { GameCanvas } from './canvas/GameCanvas'

let messageIdCounter = 0
const nextMessageId = () => `m${++messageIdCounter}`

type ViewMode = 'ships' | 'run' | 'editor'

export function App() {
  const [view, setView] = useState<ViewMode>('ships')
  const [connected, setConnected] = useState(false)
  const [sessions, setSessions] = useState<Map<string, SessionDescriptor>>(new Map())
  const [transcripts, setTranscripts] = useState<Map<string, ChatMessage[]>>(new Map())
  const [pendings, setPendings] = useState<Map<string, PendingClarification>>(new Map())
  const [activeRun, setActiveRun] = useState<RunSnapshot | null>(null)
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [tools, setTools] = useState<ToolSummary[]>([])
  const [ships, setShips] = useState<ShipSummary[]>([])
  const [testRunRequest, setTestRunRequest] = useState<TestRunRequest | null>(null)
  const [features, setFeatures] = useState<Map<number, FeatureSummary[]>>(new Map())
  const socketRef = useRef<Socket | null>(null)

  const pushMessage = useCallback((agentRunId: string, m: Omit<ChatMessage, 'id'>) => {
    setTranscripts((prev) => {
      const next = new Map(prev)
      const cur = next.get(agentRunId) ?? []
      next.set(agentRunId, [...cur, { ...m, id: nextMessageId() }])
      return next
    })
  }, [])

  useEffect(() => {
    const socket: Socket = io({ transports: ['websocket', 'polling'] })
    socketRef.current = socket

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socket.on('session:list', (list: ServerEvents['session:list']) => {
      setSessions(new Map(list.map((s) => [s.id, s])))
    })

    socket.on('session:added', (s: ServerEvents['session:added']) => {
      setSessions((prev) => new Map(prev).set(s.id, s))
    })

    socket.on('session:removed', (ev: ServerEvents['session:removed']) => {
      setSessions((prev) => {
        const next = new Map(prev)
        next.delete(ev.id)
        return next
      })
    })

    socket.on('agent:message', (m: ServerEvents['agent:message']) => {
      pushMessage(m.agentRunId, {
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })
    })

    socket.on('agent:state', (s: ServerEvents['agent:state']) => {
      setSessions((prev) => {
        const cur = prev.get(s.agentRunId)
        if (!cur) return prev
        const next = new Map(prev)
        next.set(s.agentRunId, { ...cur, state: s.state })
        return next
      })
    })

    socket.on('clarification:requested', (c: ServerEvents['clarification:requested']) => {
      setPendings((prev) =>
        new Map(prev).set(c.agentRunId, { toolUseId: c.toolUseId, question: c.question }),
      )
    })

    socket.on('clarification:resolved', (c: ServerEvents['clarification:resolved']) => {
      setPendings((prev) => {
        const next = new Map(prev)
        const cur = next.get(c.agentRunId)
        if (cur && cur.toolUseId === c.toolUseId) next.delete(c.agentRunId)
        return next
      })
    })

    socket.on('run:snapshot', (snap: RunSnapshot) => setActiveRun(snap))

    socket.on('run:started', (ev: ServerEvents['run:started']) => {
      setActiveRun({
        runId: ev.runId,
        task: ev.task,
        nodeIds: ev.nodeIds,
        nodeStates: Object.fromEntries(ev.nodeIds.map((id) => [id, 'pending' as const])),
        nodeSummaries: {},
      })
    })

    socket.on('node:started', (ev: ServerEvents['node:started']) => {
      setActiveRun((prev) =>
        prev
          ? { ...prev, nodeStates: { ...prev.nodeStates, [ev.nodeId]: 'running' } }
          : prev,
      )
    })

    socket.on('node:complete', (ev: ServerEvents['node:complete']) => {
      setActiveRun((prev) =>
        prev
          ? {
              ...prev,
              nodeStates: { ...prev.nodeStates, [ev.nodeId]: 'complete' },
              nodeSummaries: { ...prev.nodeSummaries, [ev.nodeId]: ev.summary },
            }
          : prev,
      )
    })

    socket.on('run:complete', (ev: ServerEvents['run:complete']) => {
      setActiveRun((prev) => (prev ? { ...prev, finalSummary: ev.finalSummary } : prev))
    })

    socket.on('run:failed', (ev: ServerEvents['run:failed']) => {
      setActiveRun((prev) =>
        prev
          ? {
              ...prev,
              error: ev.error,
              nodeStates: ev.nodeId
                ? { ...prev.nodeStates, [ev.nodeId]: 'failed' }
                : prev.nodeStates,
            }
          : prev,
      )
    })

    socket.on('ship:created', (s: ServerEvents['ship:created']) => {
      setShips((prev) => [s, ...prev])
    })
    socket.on('ship:deleted', (ev: ServerEvents['ship:deleted']) => {
      setShips((prev) => prev.filter((s) => s.id !== ev.id))
      setFeatures((prev) => {
        const next = new Map(prev)
        next.delete(ev.id)
        return next
      })
    })
    socket.on('feature:created', (f: ServerEvents['feature:created']) => {
      setFeatures((prev) => {
        const next = new Map(prev)
        next.set(f.shipId, [f, ...(next.get(f.shipId) ?? [])])
        return next
      })
    })
    socket.on('feature:updated', (f: ServerEvents['feature:updated']) => {
      setFeatures((prev) => {
        const next = new Map(prev)
        const list = (next.get(f.shipId) ?? []).map((x) => (x.id === f.id ? f : x))
        next.set(f.shipId, list)
        return next
      })
    })

    return () => {
      socket.close()
    }
  }, [pushMessage])

  const refreshTools = useCallback(async () => {
    try {
      const list = (await fetch('/api/global-tools').then((r) => r.json())) as ToolSummary[]
      setTools(list)
    } catch {
      // ignore — editor will show empty palette
    }
  }, [])

  // Load default workflow + global tools once for editor + run-with-default.
  useEffect(() => {
    fetch('/api/workflows')
      .then((r) => r.json())
      .then((list: Workflow[]) => {
        if (list[0]) setWorkflow(list[0])
      })
      .catch(() => {})
    void refreshTools()
    fetch('/api/ships')
      .then((r) => r.json())
      .then(async (list: ShipSummary[]) => {
        setShips(list)
        const featureMap = new Map<number, FeatureSummary[]>()
        await Promise.all(
          list.map(async (s) => {
            const fs = await fetch(`/api/ships/${s.id}/features`)
              .then((r) => r.json())
              .catch(() => [])
            featureMap.set(s.id, fs)
          }),
        )
        setFeatures(featureMap)
      })
      .catch(() => {})
  }, [refreshTools])

  const sessionList = useMemo(() => Array.from(sessions.values()), [sessions])

  const sendMessage = useCallback((agentRunId: string, content: string) => {
    socketRef.current?.emit('agent:send', { agentRunId, content })
  }, [])

  const replyClarification = useCallback(
    (agentRunId: string, toolUseId: string, answer: string) => {
      socketRef.current?.emit('clarification:reply', { agentRunId, toolUseId, answer })
    },
    [],
  )

  const startRun = useCallback(
    async (task: string) => {
      if (!workflow) {
        alert('No workflow loaded yet.')
        return
      }
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: workflow.id, task }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Run failed: ${j.error ?? res.status}`)
      }
    },
    [workflow],
  )

  const resetRun = useCallback(async () => {
    await fetch('/api/runs/reset', { method: 'POST' }).catch(() => {})
    setSessions(new Map())
    setTranscripts(new Map())
    setPendings(new Map())
    setActiveRun(null)
  }, [])

  const createShip = useCallback(async (name: string, projectPath: string) => {
    const res = await fetch('/api/ships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, projectPath }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(`Create ship failed: ${j.error ?? res.status}`)
    }
  }, [])

  const deleteShip = useCallback(async (id: number) => {
    await fetch(`/api/ships/${id}`, { method: 'DELETE' }).catch(() => {})
  }, [])

  const createFeature = useCallback(
    async (shipId: number, name: string, task: string): Promise<FeatureSummary | null> => {
      const res = await fetch(`/api/ships/${shipId}/features`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, task }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        const msg = typeof j.error === 'string' ? j.error : `HTTP ${res.status}`
        if (msg.includes('Ship path does not exist') || msg.includes('not a git repository')) {
          if (
            confirm(
              `Can't create a feature on this ship:\n\n${msg}\n\nThis usually means the project path has been moved or deleted on disk. Delete the ship from AgentYard now?`,
            )
          ) {
            await fetch(`/api/ships/${shipId}`, { method: 'DELETE' }).catch(() => {})
          }
        } else {
          alert(`Create feature failed: ${msg}`)
        }
        return null
      }
      const body = await res.json()
      return body.feature as FeatureSummary
    },
    [],
  )

  const saveWorkflow = useCallback(async (updated: Workflow) => {
    const res = await fetch(`/api/workflows/${updated.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: updated.name, graph: updated.graph }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(`Save failed: ${j.error ?? res.status}`)
      return
    }
    const saved: Workflow = await res.json()
    setWorkflow(saved)
  }, [])

  return (
    <main className="min-h-screen flex flex-col font-mono">
      <header className="border-b border-cyan-500/30 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
          <h1 className="text-cyan-300 tracking-[0.3em] text-sm">AGENTYARD</h1>
          <span className="text-zinc-600 text-xs">phase 3 / workflow editor</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setView('ships')}
            className={`px-3 py-1 border tracking-wide ${
              view === 'ships'
                ? 'border-cyan-500 text-cyan-300 bg-cyan-500/10'
                : 'border-zinc-600 text-zinc-400 hover:bg-zinc-800/50'
            }`}
          >
            ships
          </button>
          <button
            onClick={() => setView('run')}
            className={`px-3 py-1 border tracking-wide ${
              view === 'run'
                ? 'border-cyan-500 text-cyan-300 bg-cyan-500/10'
                : 'border-zinc-600 text-zinc-400 hover:bg-zinc-800/50'
            }`}
          >
            run
          </button>
          <button
            onClick={() => setView('editor')}
            className={`px-3 py-1 border tracking-wide ${
              view === 'editor'
                ? 'border-cyan-500 text-cyan-300 bg-cyan-500/10'
                : 'border-zinc-600 text-zinc-400 hover:bg-zinc-800/50'
            }`}
          >
            editor
          </button>
          <span className="mx-2 text-zinc-700">|</span>
          <span className={connected ? 'text-emerald-400' : 'text-amber-400'}>
            {connected ? '◉ link' : '○ offline'}
          </span>
        </div>
      </header>

      {view === 'ships' && (
        <GameCanvas
          ships={ships}
          features={features}
          sessions={sessionList}
          transcripts={transcripts}
          pendings={pendings}
          connected={connected}
          onCreateShip={createShip}
          onDeleteShip={deleteShip}
          onCreateFeature={createFeature}
          onSend={sendMessage}
          onClarificationReply={replyClarification}
          onOpenWorkflow={() => setView('editor')}
          onJumpToRun={() => setView('run')}
        />
      )}
      {view === 'run' && (
        <RunView
          connected={connected}
          sessions={sessionList}
          transcripts={transcripts}
          pendings={pendings}
          activeRun={activeRun}
          workflow={workflow}
          onSend={sendMessage}
          onClarificationReply={replyClarification}
          onStartRun={startRun}
          onReset={resetRun}
        />
      )}
      {view === 'editor' && (
        <EditorView
          workflow={workflow}
          tools={tools}
          onSave={saveWorkflow}
          onRefreshTools={refreshTools}
          onOpenTestRun={(req) => setTestRunRequest(req)}
        />
      )}
      {testRunRequest && workflow && (
        <TestRunModal
          request={testRunRequest}
          workflow={workflow}
          ships={ships}
          socket={socketRef.current}
          onClose={() => setTestRunRequest(null)}
        />
      )}
    </main>
  )
}
