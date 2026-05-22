import { useEffect, useMemo, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import type {
  AgentRole,
  AgentState,
  ServerEvents,
  SessionDescriptor,
  ShipSummary,
} from '../../core/types'
import type { Workflow, WorkflowNode } from '../../core/schema'

export interface TestRunRequest {
  scope: 'workflow' | 'node'
  nodeId?: string
}

interface Props {
  request: TestRunRequest
  workflow: Workflow
  ships: ShipSummary[]
  socket: Socket | null
  onClose: () => void
}

interface ChatMessage {
  id: string
  role: 'assistant' | 'user' | 'system'
  content: string
  timestamp: number
}

interface NodeProgressEntry {
  nodeId: string
  title: string
  status: 'started' | 'complete' | 'skipped' | 'failed'
  summary?: string
  timestamp: number
}

type Stage = 'form' | 'running' | 'done' | 'failed' | 'aborted'

const STATE_LABELS: Record<AgentState, string> = {
  idle: 'standby',
  thinking: 'thinking',
  tool_running: 'tool',
  awaiting_clarification: 'awaiting',
  done: 'done',
  failed: 'error',
}

const STATE_COLORS: Record<AgentState, string> = {
  idle: 'text-zinc-400',
  thinking: 'text-cyan-300',
  tool_running: 'text-purple-300',
  awaiting_clarification: 'text-amber-300',
  done: 'text-zinc-500',
  failed: 'text-rose-400',
}

const ROLE_COLORS: Record<AgentRole, string> = {
  leader: 'text-fuchsia-300',
  drone: 'text-cyan-300',
  free: 'text-emerald-300',
}

const SYSTEM_TAB_ID = '__system__'
let msgCounter = 0
const nextMsgId = () => `m${++msgCounter}`

export function TestRunModal({ request, workflow, ships, socket, onClose }: Props) {
  const targetNode: WorkflowNode | null =
    request.scope === 'node' && request.nodeId
      ? workflow.graph.nodes.find((n) => n.id === request.nodeId) ?? null
      : null
  const customNodes = useMemo(
    () => new Map(workflow.graph.nodes.filter((n) => n.type === 'custom').map((n) => [n.id, n])),
    [workflow.graph.nodes],
  )

  const [stage, setStage] = useState<Stage>('form')
  const [shipId, setShipId] = useState<number | null>(ships[0]?.id ?? null)
  const [task, setTask] = useState('')
  const [upstreamOutputs, setUpstreamOutputs] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [testRunId, setTestRunId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionDescriptor[]>([])
  const [transcripts, setTranscripts] = useState<Map<string, ChatMessage[]>>(new Map())
  const [pendings, setPendings] = useState<Map<string, { toolUseId: string; question: string }>>(
    new Map(),
  )
  const [nodeProgress, setNodeProgress] = useState<NodeProgressEntry[]>([])
  const [scriptOutputs, setScriptOutputs] = useState<Map<string, string>>(new Map())
  const [finalSummary, setFinalSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedTab, setSelectedTab] = useState<string>(SYSTEM_TAB_ID)
  const [chatInput, setChatInput] = useState('')
  const [replyInput, setReplyInput] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)

  // Whenever the visible transcript changes, scroll to bottom.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [selectedTab, transcripts, pendings, nodeProgress, scriptOutputs, finalSummary, error])

  // Auto-select a new agent tab the first time it appears (only while running).
  useEffect(() => {
    if (stage !== 'running') return
    if (selectedTab === SYSTEM_TAB_ID && sessions.length > 0) {
      setSelectedTab(sessions[0]!.id)
    }
  }, [sessions, selectedTab, stage])

  // Subscribe to test-run:* events for the active testRunId.
  useEffect(() => {
    if (!socket || !testRunId) return
    const matches = (ev: { testRunId: string }) => ev.testRunId === testRunId

    const onStarted = (_ev: ServerEvents['test-run:started']) => {
      if (!matches(_ev)) return
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
        const next = new Map(p)
        next.set(ev.descriptor.id, undefined as unknown as { toolUseId: string; question: string })
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
          {
            id: nextMsgId(),
            role: ev.role,
            content: ev.content,
            timestamp: ev.timestamp,
          },
        ])
        return next
      })
    }
    const onState = (ev: ServerEvents['test-run:agent:state']) => {
      if (!matches(ev)) return
      setSessions((sx) => sx.map((s) => (s.id === ev.agentRunId ? { ...s, state: ev.state } : s)))
    }
    const onClarRequested = (ev: ServerEvents['test-run:clarification:requested']) => {
      if (!matches(ev)) return
      setPendings((p) => {
        const next = new Map(p)
        next.set(ev.agentRunId, { toolUseId: ev.toolUseId, question: ev.question })
        return next
      })
    }
    const onClarResolved = (ev: ServerEvents['test-run:clarification:resolved']) => {
      if (!matches(ev)) return
      setPendings((p) => {
        const next = new Map(p)
        const cur = next.get(ev.agentRunId)
        if (cur?.toolUseId === ev.toolUseId) next.delete(ev.agentRunId)
        return next
      })
    }
    const onTeardown = (ev: ServerEvents['test-run:teardown']) => {
      if (!matches(ev)) return
      // No-op besides noting that the server cleaned up.
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

  async function submit() {
    if (!shipId) {
      setSubmitError('Select a ship')
      return
    }
    if (task.trim().length === 0) {
      setSubmitError('Task is required')
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/test-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipId,
          workflowId: workflow.id,
          task,
          scope: request.scope,
          nodeId: request.nodeId,
          upstreamOutputs: request.scope === 'node' ? upstreamOutputs : undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitError(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`)
        setSubmitting(false)
        return
      }
      setTestRunId(body.testRunId)
      setStage('running')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  async function abort() {
    if (!testRunId) return
    setStage('aborted')
    await fetch(`/api/test-runs/${testRunId}/abort`, { method: 'POST' }).catch(() => {})
  }

  function sendBarge() {
    const text = chatInput.trim()
    if (!text || !testRunId || !socket || selectedTab === SYSTEM_TAB_ID) return
    if (selectedTab.startsWith('script:')) return
    socket.emit('test-run:agent:send', {
      testRunId,
      agentRunId: selectedTab,
      content: text,
    })
    setChatInput('')
  }

  function sendReply() {
    const text = replyInput.trim()
    if (!text || !testRunId || !socket) return
    const pending = pendings.get(selectedTab)
    if (!pending) return
    socket.emit('test-run:clarification:reply', {
      testRunId,
      agentRunId: selectedTab,
      toolUseId: pending.toolUseId,
      answer: text,
    })
    setReplyInput('')
  }

  const headerLabel =
    request.scope === 'workflow'
      ? `test workflow › ${workflow.name}`
      : `test node › ${targetNode?.title ?? request.nodeId}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative bg-black border border-fuchsia-500/60 shadow-[0_0_30px_rgba(217,70,239,0.25)] w-[min(1100px,95vw)] h-[min(800px,90vh)] flex flex-col">
        {/* Header */}
        <div className="px-4 py-2 border-b border-fuchsia-500/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-fuchsia-300 text-xs tracking-[0.3em] uppercase">sandbox</span>
            <span className="text-zinc-300 text-xs">{headerLabel}</span>
            {testRunId && (
              <span className="text-zinc-600 text-[10px] font-mono">{testRunId}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {stage === 'running' && (
              <button
                onClick={abort}
                className="px-2 py-0.5 border border-rose-500/60 text-rose-300 hover:bg-rose-500/20 text-xs"
              >
                abort
              </button>
            )}
            <button
              onClick={onClose}
              className="px-2 py-0.5 border border-zinc-500 text-zinc-400 hover:bg-zinc-700/40 text-xs"
            >
              close
            </button>
          </div>
        </div>

        {stage === 'form' ? (
          <FormStage
            ships={ships}
            shipId={shipId}
            setShipId={setShipId}
            task={task}
            setTask={setTask}
            request={request}
            targetNode={targetNode}
            upstreamOutputs={upstreamOutputs}
            setUpstreamOutputs={setUpstreamOutputs}
            submitting={submitting}
            submitError={submitError}
            onSubmit={submit}
          />
        ) : (
          <LiveStage
            stage={stage}
            sessions={sessions}
            transcripts={transcripts}
            pendings={pendings}
            nodeProgress={nodeProgress}
            scriptOutputs={scriptOutputs}
            customNodes={customNodes}
            finalSummary={finalSummary}
            error={error}
            selectedTab={selectedTab}
            setSelectedTab={setSelectedTab}
            scrollRef={scrollRef}
            chatInput={chatInput}
            setChatInput={setChatInput}
            replyInput={replyInput}
            setReplyInput={setReplyInput}
            onSendBarge={sendBarge}
            onSendReply={sendReply}
          />
        )}
      </div>
    </div>
  )
}

function FormStage(props: {
  ships: ShipSummary[]
  shipId: number | null
  setShipId: (id: number) => void
  task: string
  setTask: (s: string) => void
  request: TestRunRequest
  targetNode: WorkflowNode | null
  upstreamOutputs: string
  setUpstreamOutputs: (s: string) => void
  submitting: boolean
  submitError: string | null
  onSubmit: () => void
}) {
  const {
    ships,
    shipId,
    setShipId,
    task,
    setTask,
    request,
    targetNode,
    upstreamOutputs,
    setUpstreamOutputs,
    submitting,
    submitError,
    onSubmit,
  } = props
  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-xs">
      <p className="text-zinc-400 leading-relaxed">
        Spawns a disposable git worktree on the selected ship, runs the{' '}
        {request.scope === 'workflow' ? 'whole workflow' : 'selected node only'} in that sandbox,
        and tears the worktree down when the run ends. Your project files outside the sandbox are
        not touched.
      </p>

      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">SHIP</label>
        {ships.length === 0 ? (
          <p className="text-zinc-600 italic">
            // no ships registered. create one from the galaxy view first.
          </p>
        ) : (
          <select
            value={shipId ?? ''}
            onChange={(e) => setShipId(Number(e.target.value))}
            className="w-full bg-black border border-fuchsia-500/40 rounded px-2 py-1 focus:outline-none focus:border-fuchsia-300"
          >
            {ships.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.projectPath}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">
          TASK ({'{task}'} substitution value)
        </label>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
          placeholder="e.g. add a hello world endpoint"
          className="w-full bg-black border border-fuchsia-500/40 rounded p-2 text-zinc-200 focus:outline-none focus:border-fuchsia-300 font-mono"
        />
      </div>

      {request.scope === 'node' && (
        <div>
          <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">
            UPSTREAM_OUTPUTS ({'{upstream_outputs}'} substitution value — leave blank if not used)
          </label>
          {targetNode && (
            <p className="text-zinc-600 text-[10px] mb-1">
              testing node: <span className="text-fuchsia-300">{targetNode.id}</span> (
              <span className="text-zinc-500">{targetNode.type}</span>)
            </p>
          )}
          <textarea
            value={upstreamOutputs}
            onChange={(e) => setUpstreamOutputs(e.target.value)}
            rows={4}
            placeholder="paste whatever you want the node to see as its upstream context"
            className="w-full bg-black border border-fuchsia-500/40 rounded p-2 text-zinc-200 focus:outline-none focus:border-fuchsia-300 font-mono"
          />
        </div>
      )}

      {submitError && (
        <p className="text-rose-300 text-xs">// {submitError}</p>
      )}

      <div className="flex justify-end">
        <button
          onClick={onSubmit}
          disabled={submitting || !shipId || task.trim().length === 0}
          className="px-4 py-2 border border-fuchsia-500 text-fuchsia-200 hover:bg-fuchsia-500/20 tracking-wide disabled:opacity-30"
        >
          {submitting ? 'launching…' : '▶ launch sandbox'}
        </button>
      </div>
    </div>
  )
}

function LiveStage(props: {
  stage: Stage
  sessions: SessionDescriptor[]
  transcripts: Map<string, ChatMessage[]>
  pendings: Map<string, { toolUseId: string; question: string }>
  nodeProgress: NodeProgressEntry[]
  scriptOutputs: Map<string, string>
  customNodes: Map<string, WorkflowNode>
  finalSummary: string | null
  error: string | null
  selectedTab: string
  setSelectedTab: (id: string) => void
  scrollRef: React.RefObject<HTMLDivElement>
  chatInput: string
  setChatInput: (s: string) => void
  replyInput: string
  setReplyInput: (s: string) => void
  onSendBarge: () => void
  onSendReply: () => void
}) {
  const {
    stage,
    sessions,
    transcripts,
    pendings,
    nodeProgress,
    scriptOutputs,
    customNodes,
    finalSummary,
    error,
    selectedTab,
    setSelectedTab,
    scrollRef,
    chatInput,
    setChatInput,
    replyInput,
    setReplyInput,
    onSendBarge,
    onSendReply,
  } = props

  const scriptTabIds = Array.from(scriptOutputs.keys()).map((id) => `script:${id}`)
  const selectedSession =
    selectedTab !== SYSTEM_TAB_ID && !selectedTab.startsWith('script:')
      ? sessions.find((s) => s.id === selectedTab)
      : null
  const selectedTranscript = selectedSession ? transcripts.get(selectedSession.id) ?? [] : []
  const selectedPending = selectedSession ? pendings.get(selectedSession.id) : null

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab strip */}
      <div className="flex items-stretch border-b border-fuchsia-500/30 overflow-x-auto">
        <TabButton
          active={selectedTab === SYSTEM_TAB_ID}
          onClick={() => setSelectedTab(SYSTEM_TAB_ID)}
        >
          <span className="text-fuchsia-300">▣</span>
          <span>run</span>
          {stage === 'running' && <Dot className="bg-cyan-300" />}
          {stage === 'done' && <Dot className="bg-emerald-400" />}
          {(stage === 'failed' || stage === 'aborted') && <Dot className="bg-rose-400" />}
        </TabButton>
        {sessions.map((s) => {
          const hasPending = pendings.has(s.id)
          return (
            <TabButton key={s.id} active={selectedTab === s.id} onClick={() => setSelectedTab(s.id)}>
              <span className={ROLE_COLORS[s.role]}>{s.role}</span>
              <span className="text-zinc-300">{s.label ?? s.id.slice(0, 8)}</span>
              <span className={`${STATE_COLORS[s.state]} text-[10px]`}>
                · {STATE_LABELS[s.state]}
              </span>
              {hasPending && <Dot className="bg-amber-400" />}
            </TabButton>
          )
        })}
        {scriptTabIds.map((tid) => {
          const nodeId = tid.slice('script:'.length)
          const node = customNodes.get(nodeId)
          return (
            <TabButton key={tid} active={selectedTab === tid} onClick={() => setSelectedTab(tid)}>
              <span className="text-amber-300">script</span>
              <span className="text-zinc-300">{node?.title ?? nodeId}</span>
            </TabButton>
          )
        })}
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 text-xs">
        {selectedTab === SYSTEM_TAB_ID ? (
          <SystemPane
            stage={stage}
            nodeProgress={nodeProgress}
            finalSummary={finalSummary}
            error={error}
          />
        ) : selectedTab.startsWith('script:') ? (
          <ScriptPane
            nodeId={selectedTab.slice('script:'.length)}
            customNodes={customNodes}
            output={scriptOutputs.get(selectedTab.slice('script:'.length)) ?? ''}
          />
        ) : (
          <AgentPane transcript={selectedTranscript} pending={selectedPending ?? null} />
        )}
      </div>

      {/* Footer: chat / reply input — only when a real agent tab is selected */}
      {selectedSession && stage === 'running' && (
        <div className="border-t border-fuchsia-500/30 px-4 py-3 space-y-2">
          {selectedPending ? (
            <div className="flex items-stretch gap-2">
              <textarea
                value={replyInput}
                onChange={(e) => setReplyInput(e.target.value)}
                rows={2}
                placeholder="answer the clarification…"
                className="flex-1 bg-black border border-amber-500/60 rounded p-2 text-zinc-100 focus:outline-none focus:border-amber-300 font-mono text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    onSendReply()
                  }
                }}
              />
              <button
                onClick={onSendReply}
                disabled={replyInput.trim().length === 0}
                className="px-3 border border-amber-500/60 text-amber-300 hover:bg-amber-500/20 disabled:opacity-30 text-xs"
              >
                reply
              </button>
            </div>
          ) : (
            <div className="flex items-stretch gap-2">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                rows={2}
                placeholder="barge in…"
                className="flex-1 bg-black border border-zinc-600 rounded p-2 text-zinc-100 focus:outline-none focus:border-cyan-300 font-mono text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    onSendBarge()
                  }
                }}
              />
              <button
                onClick={onSendBarge}
                disabled={chatInput.trim().length === 0}
                className="px-3 border border-zinc-600 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 text-xs"
              >
                send
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 flex items-center gap-1.5 text-[11px] border-r border-fuchsia-500/30 whitespace-nowrap ${
        active
          ? 'bg-fuchsia-500/10 text-fuchsia-100'
          : 'text-zinc-400 hover:bg-zinc-800/40'
      }`}
    >
      {children}
    </button>
  )
}

function Dot({ className }: { className: string }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${className}`} />
}

function SystemPane({
  stage,
  nodeProgress,
  finalSummary,
  error,
}: {
  stage: Stage
  nodeProgress: NodeProgressEntry[]
  finalSummary: string | null
  error: string | null
}) {
  return (
    <div className="space-y-2">
      <div className="text-zinc-500 text-[10px] tracking-widest uppercase">
        run progress · stage: {stage}
      </div>
      {nodeProgress.length === 0 && (
        <p className="text-zinc-600 italic">// waiting for first node…</p>
      )}
      {nodeProgress.map((e, i) => (
        <div key={i} className="flex items-baseline gap-2">
          <span className="text-zinc-600 text-[10px]">
            {new Date(e.timestamp).toLocaleTimeString()}
          </span>
          <span
            className={
              e.status === 'started'
                ? 'text-cyan-300'
                : e.status === 'complete'
                  ? 'text-emerald-300'
                  : e.status === 'skipped'
                    ? 'text-zinc-500'
                    : 'text-rose-400'
            }
          >
            {e.status}
          </span>
          <span className="text-zinc-300">{e.title}</span>
          <span className="text-zinc-600 text-[10px]">({e.nodeId})</span>
          {e.summary && (
            <span className="text-zinc-500 text-[10px] truncate max-w-[400px]">
              {e.summary}
            </span>
          )}
        </div>
      ))}
      {finalSummary !== null && (
        <div className="mt-4 border-t border-emerald-500/30 pt-3">
          <div className="text-emerald-300 text-[10px] tracking-widest uppercase mb-1">
            final summary
          </div>
          <p className="text-zinc-100 whitespace-pre-wrap">{finalSummary}</p>
        </div>
      )}
      {error && (
        <div className="mt-4 border-t border-rose-500/30 pt-3">
          <div className="text-rose-300 text-[10px] tracking-widest uppercase mb-1">error</div>
          <p className="text-rose-200 whitespace-pre-wrap">{error}</p>
        </div>
      )}
    </div>
  )
}

function ScriptPane({
  nodeId,
  customNodes,
  output,
}: {
  nodeId: string
  customNodes: Map<string, WorkflowNode>
  output: string
}) {
  const node = customNodes.get(nodeId)
  return (
    <div className="space-y-3">
      <div className="text-zinc-500 text-[10px] tracking-widest uppercase">
        script node · {node?.scriptName ?? '(no script)'}
      </div>
      {output.length === 0 ? (
        <p className="text-zinc-600 italic">// running…</p>
      ) : (
        <pre className="text-zinc-100 whitespace-pre-wrap font-mono text-xs">{output}</pre>
      )}
    </div>
  )
}

function AgentPane({
  transcript,
  pending,
}: {
  transcript: ChatMessage[]
  pending: { toolUseId: string; question: string } | null
}) {
  if (transcript.length === 0 && !pending) {
    return <p className="text-zinc-600 italic">// no messages yet</p>
  }
  return (
    <div className="space-y-2">
      {transcript.map((m) => (
        <MessageRow key={m.id} m={m} />
      ))}
      {pending && (
        <div className="border-l-2 border-amber-500/60 pl-3 py-1 bg-amber-500/5">
          <div className="text-amber-300 text-[10px] tracking-widest uppercase mb-1">
            clarification requested
          </div>
          <p className="text-zinc-100 whitespace-pre-wrap">{pending.question}</p>
        </div>
      )}
    </div>
  )
}

function MessageRow({ m }: { m: ChatMessage }) {
  const label =
    m.role === 'user' ? 'YOU' : m.role === 'assistant' ? 'AGENT' : 'SYS'
  const color =
    m.role === 'user'
      ? 'text-emerald-300'
      : m.role === 'assistant'
        ? 'text-cyan-300'
        : 'text-zinc-500'
  return (
    <div className="flex gap-3">
      <span className={`${color} text-[10px] tracking-widest uppercase pt-0.5 w-12 shrink-0`}>
        {label}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-zinc-100 whitespace-pre-wrap break-words">{m.content}</p>
        <p className="text-zinc-600 text-[10px] mt-0.5">
          {new Date(m.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  )
}
