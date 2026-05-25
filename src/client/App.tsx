import { lazy, Suspense, startTransition, useCallback, useEffect, useState } from 'react'
import type { FeatureSummary, ShipSummary } from '../core/types'
import type { Workflow } from '../core/schema'
import type { ToolSummary } from '../core/tools'
import type { TestRunRequest } from './views/TestRunModal'
import {
  useActiveRun,
  useConnected,
  useFeaturesMap,
  usePendingsMap,
  useSessionList,
  useShips,
  useSocketStore,
  useTranscriptsMap,
} from './state/socketStore'
import {
  getSocket,
  initSocketClient,
  replyClarification as emitReplyClarification,
  sendAgentMessage,
} from './state/socketClient'
import { apiDelete, apiGet, apiPost, apiPut } from './api'
import { pushToast } from './state/toastStore'
import { Toasts } from './components/Toasts'

type ViewMode = 'ships' | 'run' | 'editor'

// Lazy loaders are exposed so tab hovers can preload the bundle before click.
const loadGameCanvas = () => import('./canvas/GameCanvas')
const loadRunView = () => import('./views/RunView')
const loadEditorView = () => import('./views/EditorView')
const loadTestRunModal = () => import('./views/TestRunModal')

const GameCanvas = lazy(() => loadGameCanvas().then((m) => ({ default: m.GameCanvas })))
const RunView = lazy(() => loadRunView().then((m) => ({ default: m.RunView })))
const EditorView = lazy(() => loadEditorView().then((m) => ({ default: m.EditorView })))
const TestRunModal = lazy(() => loadTestRunModal().then((m) => ({ default: m.TestRunModal })))

const PRELOADERS: Record<ViewMode, () => Promise<unknown>> = {
  ships: loadGameCanvas,
  run: loadRunView,
  editor: loadEditorView,
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-cyan-500/60 text-xs tracking-[0.3em]">
      ◌ loading {label}…
    </div>
  )
}

export function App() {
  const [view, setView] = useState<ViewMode>('ships')
  // Track which views the user has actually visited so we don't pay their JS
  // download cost at boot. Once visited, a view stays mounted (the z-index
  // layering described below requires this so xyflow / Pixi don't lose their
  // measurements).
  const [visited, setVisited] = useState<Set<ViewMode>>(() => new Set(['ships']))
  const navigate = useCallback((next: ViewMode) => {
    // First-time mounts of EditorView (xyflow) and GameCanvas (Pixi) can
    // block paint for tens of ms. Marking the swap as a transition lets
    // React keep the current view responsive while the new one mounts.
    startTransition(() => {
      setView(next)
      setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
    })
  }, [])
  const preload = useCallback((target: ViewMode) => {
    void PRELOADERS[target]()
  }, [])

  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [tools, setTools] = useState<ToolSummary[]>([])
  const [testRunRequest, setTestRunRequest] = useState<TestRunRequest | null>(null)

  // Socket-driven state lives in the Zustand store. Each view reads only what
  // it needs so an unrelated event no longer cascades through the whole tree.
  const connected = useConnected()
  const sessionList = useSessionList()
  const transcripts = useTranscriptsMap()
  const pendings = usePendingsMap()
  const activeRun = useActiveRun()
  const ships = useShips()
  const features = useFeaturesMap()

  // Wire the socket up once on mount; the client module is idempotent.
  useEffect(() => {
    initSocketClient()
  }, [])

  const refreshTools = useCallback(async () => {
    const res = await apiGet<ToolSummary[]>('/api/global-tools')
    if (res.ok) setTools(res.data)
    // Failure path is silent: editor falls back to an empty palette.
  }, [])

  // Load default workflow + global tools once for editor + run-with-default.
  useEffect(() => {
    void (async () => {
      const wf = await apiGet<Workflow[]>('/api/workflows')
      if (wf.ok && wf.data[0]) setWorkflow(wf.data[0])

      const shipsRes = await apiGet<ShipSummary[]>('/api/ships')
      if (!shipsRes.ok) return
      useSocketStore.getState().setShips(shipsRes.data)
      const featureMap = new Map<number, FeatureSummary[]>()
      await Promise.all(
        shipsRes.data.map(async (s) => {
          const fs = await apiGet<FeatureSummary[]>(`/api/ships/${s.id}/features`)
          featureMap.set(s.id, fs.ok ? fs.data : [])
        }),
      )
      useSocketStore.getState().setFeatures(featureMap)
    })()
    void refreshTools()
  }, [refreshTools])

  const sendMessage = useCallback((agentRunId: string, content: string) => {
    sendAgentMessage(agentRunId, content)
  }, [])

  const replyClarification = useCallback(
    (agentRunId: string, toolUseId: string, answer: string) => {
      emitReplyClarification(agentRunId, toolUseId, answer)
    },
    [],
  )

  const startRun = useCallback(
    async (task: string) => {
      if (!workflow) {
        pushToast('error', 'No workflow loaded yet.')
        return
      }
      const res = await apiPost('/api/runs', { workflowId: workflow.id, task })
      if (!res.ok) pushToast('error', `Run failed: ${res.error}`)
    },
    [workflow],
  )

  const resetRun = useCallback(async () => {
    await apiPost('/api/runs/reset')
    useSocketStore.getState().resetRun()
  }, [])

  const createShip = useCallback(async (name: string, projectPath: string) => {
    const res = await apiPost('/api/ships', { name, projectPath })
    if (!res.ok) pushToast('error', `Create ship failed: ${res.error}`)
  }, [])

  const deleteShip = useCallback(async (id: number) => {
    await apiDelete(`/api/ships/${id}`)
  }, [])

  const createFeature = useCallback(
    async (shipId: number, name: string, task: string): Promise<FeatureSummary | null> => {
      const res = await apiPost<{ feature: FeatureSummary }>(
        `/api/ships/${shipId}/features`,
        { name, task },
      )
      if (!res.ok) {
        const msg = res.error
        // Path-missing / not-a-repo is a recoverable user-facing condition —
        // offer to remove the now-orphaned ship.
        if (msg.includes('Ship path does not exist') || msg.includes('not a git repository')) {
          if (
            confirm(
              `Can't create a feature on this ship:\n\n${msg}\n\nThis usually means the project path has been moved or deleted on disk. Delete the ship from AgentYard now?`,
            )
          ) {
            await apiDelete(`/api/ships/${shipId}`)
          }
        } else {
          pushToast('error', `Create feature failed: ${msg}`)
        }
        return null
      }
      return res.data.feature
    },
    [],
  )

  const saveWorkflow = useCallback(async (updated: Workflow) => {
    const res = await apiPut<Workflow>(`/api/workflows/${updated.id}`, {
      name: updated.name,
      graph: updated.graph,
    })
    if (!res.ok) {
      pushToast('error', `Save failed: ${res.error}`)
      return
    }
    setWorkflow(res.data)
  }, [])

  return (
    <main className="min-h-screen flex flex-col font-mono bg-black">
      <header className="border-b border-cyan-500/30 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
          <h1 className="text-cyan-300 tracking-[0.3em] text-sm">AGENTYARD</h1>
          <span className="text-zinc-600 text-xs">phase 3 / workflow editor</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => navigate('ships')}
            onMouseEnter={() => preload('ships')}
            onFocus={() => preload('ships')}
            className={`px-3 py-1 border tracking-wide ${
              view === 'ships'
                ? 'border-cyan-500 text-cyan-300 bg-cyan-500/10'
                : 'border-zinc-600 text-zinc-400 hover:bg-zinc-800/50'
            }`}
          >
            ships
          </button>
          <button
            onClick={() => navigate('run')}
            onMouseEnter={() => preload('run')}
            onFocus={() => preload('run')}
            className={`px-3 py-1 border tracking-wide ${
              view === 'run'
                ? 'border-cyan-500 text-cyan-300 bg-cyan-500/10'
                : 'border-zinc-600 text-zinc-400 hover:bg-zinc-800/50'
            }`}
          >
            run
          </button>
          <button
            onClick={() => navigate('editor')}
            onMouseEnter={() => preload('editor')}
            onFocus={() => preload('editor')}
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

      {/*
        All three views stay mounted at all times and are stacked as absolute
        layers; the active layer wins via `z-10`. We can't use `hidden` /
        `display:none` on inactive layers because libraries that measure once
        on mount (React Flow's `fitView`, PixiJS) would compute against zero
        and never re-fit. We also can't use `visibility: hidden` on the
        wrapper — React Flow sets `visibility: visible` on its nodes, breaking
        inheritance, so the editor's nodes paint through onto whichever layer
        is active. The opaque `bg-black` on the active layer covers everything
        below it; `pointer-events-none` on inactive layers keeps clicks routed
        to the active one. Trade-off: hidden views keep running (PixiJS RAF,
        React Flow reconciliation) — minor CPU.
      */}
      <div className="flex-1 relative">
        <div
          className={`absolute inset-0 flex flex-col bg-black ${
            view === 'ships' ? 'z-10' : 'z-0 pointer-events-none'
          }`}
        >
          {visited.has('ships') && (
            <Suspense fallback={<LoadingPanel label="shipyard" />}>
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
                onOpenWorkflow={() => navigate('editor')}
                onJumpToRun={() => navigate('run')}
              />
            </Suspense>
          )}
        </div>
        <div
          className={`absolute inset-0 flex flex-col bg-black ${
            view === 'run' ? 'z-10' : 'z-0 pointer-events-none'
          }`}
        >
          {visited.has('run') && (
            <Suspense fallback={<LoadingPanel label="run console" />}>
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
            </Suspense>
          )}
        </div>
        <div
          className={`absolute inset-0 flex flex-col bg-black ${
            view === 'editor' ? 'z-10' : 'z-0 pointer-events-none'
          }`}
        >
          {visited.has('editor') && (
            <Suspense fallback={<LoadingPanel label="editor" />}>
              <EditorView
                workflow={workflow}
                tools={tools}
                onSave={saveWorkflow}
                onRefreshTools={refreshTools}
                onOpenTestRun={(req) => setTestRunRequest(req)}
              />
            </Suspense>
          )}
        </div>
      </div>
      {testRunRequest && workflow && (
        <Suspense fallback={null}>
          <TestRunModal
            request={testRunRequest}
            workflow={workflow}
            ships={ships}
            socket={getSocket()}
            onClose={() => setTestRunRequest(null)}
          />
        </Suspense>
      )}
      <Toasts />
    </main>
  )
}
