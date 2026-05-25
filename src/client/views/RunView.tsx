import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentRole,
  AgentState,
  NodeRunStatus,
  RunSnapshot,
  SessionDescriptor,
} from '../../core/types'
import type { Workflow } from '../../core/schema'
import { EmptyMessage } from '../components/ui/EmptyMessage'
import { useDismissable } from '../hooks/useDismissable'

export interface ChatMessage {
  role: 'assistant' | 'user' | 'system'
  content: string
  timestamp: number
  id: string
}

export interface PendingClarification {
  toolUseId: string
  question: string
}

interface Props {
  connected: boolean
  sessions: SessionDescriptor[]
  transcripts: Map<string, ChatMessage[]>
  pendings: Map<string, PendingClarification>
  activeRun: RunSnapshot | null
  workflow: Workflow | null
  onSend: (agentRunId: string, content: string) => void
  onClarificationReply: (agentRunId: string, toolUseId: string, answer: string) => void
  onStartRun: (task: string) => Promise<void> | void
  onReset: () => Promise<void> | void
}

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

const NODE_STATUS_COLORS: Record<NodeRunStatus, string> = {
  pending: 'text-zinc-500',
  running: 'text-cyan-300',
  complete: 'text-emerald-300',
  failed: 'text-rose-400',
}

export function RunView(props: Props) {
  const {
    connected,
    sessions,
    transcripts,
    pendings,
    activeRun,
    workflow,
    onSend,
    onClarificationReply,
    onStartRun,
    onReset,
  } = props

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [reply, setReply] = useState('')
  const [runPromptOpen, setRunPromptOpen] = useState(false)
  const [taskDraft, setTaskDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useDismissable(runPromptOpen, () => setRunPromptOpen(false))

  // Auto-select first agent if none selected.
  useEffect(() => {
    if (!selectedId && sessions.length > 0) setSelectedId(sessions[0]!.id)
    if (selectedId && !sessions.find((s) => s.id === selectedId)) {
      setSelectedId(sessions[0]?.id ?? null)
    }
  }, [sessions, selectedId])

  useEffect(() => {
    setInput('')
    setReply('')
  }, [selectedId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [selectedId, transcripts, pendings])

  const selectedSession = sessions.find((s) => s.id === selectedId)
  const selectedTranscript = selectedId ? transcripts.get(selectedId) ?? [] : []
  const selectedPending = selectedId ? pendings.get(selectedId) ?? null : null

  function send() {
    const text = input.trim()
    if (!text || !selectedId) return
    onSend(selectedId, text)
    setInput('')
  }

  function sendReply() {
    const text = reply.trim()
    if (!text || !selectedPending || !selectedId) return
    onClarificationReply(selectedId, selectedPending.toolUseId, text)
    setReply('')
  }

  async function submitRun() {
    const task = taskDraft.trim()
    if (!task) return
    setRunPromptOpen(false)
    setTaskDraft('')
    await onStartRun(task)
  }

  const runInFlight = !!activeRun && !activeRun.finalSummary && !activeRun.error
  const nodeTitles = useMemo(() => {
    const m: Record<string, string> = {}
    if (workflow) for (const n of workflow.graph.nodes) m[n.id] = n.title
    return m
  }, [workflow])

  return (
    <>
      <div className="border-b border-cyan-500/20 px-6 py-2 flex items-center gap-2 text-xs">
        <button
          onClick={() => setRunPromptOpen(true)}
          disabled={!connected || runInFlight || !workflow}
          className="px-3 py-1 border border-fuchsia-500 text-fuchsia-300 hover:bg-fuchsia-500 hover:text-black tracking-wide disabled:opacity-30"
        >
          ▶ run workflow
        </button>
        <button
          onClick={onReset}
          disabled={!connected}
          className="px-3 py-1 border border-zinc-500 text-zinc-400 hover:bg-zinc-700 tracking-wide disabled:opacity-30"
        >
          reset
        </button>
        {activeRun && (
          <span className="ml-3 text-zinc-500">
            run <span className="text-zinc-300">{activeRun.runId.slice(0, 8)}</span> · task{' '}
            <span className="text-zinc-300">{activeRun.task.slice(0, 60)}{activeRun.task.length > 60 ? '…' : ''}</span>
          </span>
        )}
      </div>

      {activeRun && activeRun.nodeIds.length > 0 && (
        <div className="border-b border-cyan-500/10 px-6 py-2 flex items-center gap-3 text-xs">
          {activeRun.nodeIds.map((id, i) => {
            const status = activeRun.nodeStates[id] ?? 'pending'
            return (
              <span key={id} className="flex items-center gap-2">
                {i > 0 && <span className="text-zinc-700">→</span>}
                <span className={`${NODE_STATUS_COLORS[status]} tracking-wide`}>
                  {nodeTitles[id] ?? id} · {status}
                </span>
              </span>
            )
          })}
          {activeRun.finalSummary && (
            <span className="ml-3 text-emerald-300">✓ run complete</span>
          )}
          {activeRun.error && (
            <span className="ml-3 text-rose-400">✗ {activeRun.error}</span>
          )}
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
          // no agents online. click <span className="mx-1 text-fuchsia-400">run workflow</span> to spawn a workflow run.
        </div>
      ) : (
        <>
          <nav className="border-b border-cyan-500/20 px-4 flex items-center overflow-x-auto">
            {sessions.map((s) => {
              const sel = s.id === selectedId
              const hasPending = pendings.has(s.id)
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`px-4 py-2 text-xs tracking-wider border-r border-cyan-500/10 flex items-center gap-2 transition-colors ${
                    sel ? 'bg-cyan-500/10 text-cyan-200' : 'text-zinc-400 hover:bg-zinc-800/50'
                  }`}
                >
                  <span className={ROLE_COLORS[s.role]}>{s.role.toUpperCase()}</span>
                  <span>{s.label ?? s.id.slice(0, 8)}</span>
                  <span className={`${STATE_COLORS[s.state]} text-[10px]`}>
                    · {STATE_LABELS[s.state]}
                  </span>
                  {hasPending && (
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_6px_rgba(251,191,36,0.7)]" />
                  )}
                </button>
              )
            })}
          </nav>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3 text-sm">
            {selectedSession && (
              <EmptyMessage className="text-xs">
                viewing {selectedSession.role} &quot;{selectedSession.label ?? selectedSession.id}&quot;
              </EmptyMessage>
            )}
            {selectedTranscript.length === 0 && (
              <EmptyMessage>no transmissions yet.</EmptyMessage>
            )}
            {selectedTranscript.map((m) => (
              <MessageRow key={m.id} m={m} />
            ))}
            {selectedPending && (
              <div className="border border-amber-400/60 rounded p-4 bg-amber-500/5">
                <div className="text-amber-300 text-xs tracking-widest mb-2">
                  » INCOMING TRANSMISSION — clarification requested
                </div>
                <div className="text-zinc-100 mb-3 whitespace-pre-wrap">
                  {selectedPending.question}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendReply()}
                    placeholder="your reply..."
                    className="flex-1 bg-black border border-amber-400/40 rounded px-2 py-1 text-sm focus:outline-none focus:border-amber-300"
                    autoFocus
                  />
                  <button
                    onClick={sendReply}
                    className="px-3 py-1 border border-amber-400 text-amber-300 hover:bg-amber-400 hover:text-black text-xs tracking-wide"
                  >
                    transmit
                  </button>
                </div>
              </div>
            )}
          </div>

          <footer className="border-t border-cyan-500/30 px-6 py-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder={
                  selectedSession
                    ? `> transmit to ${selectedSession.label ?? selectedSession.id}...`
                    : '> no agent selected'
                }
                disabled={!connected || !selectedId}
                className="flex-1 bg-black border border-cyan-500/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-cyan-300 disabled:opacity-50"
              />
              <button
                onClick={send}
                disabled={!connected || !input.trim() || !selectedId}
                className="px-4 py-2 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black text-xs tracking-wide disabled:opacity-30 disabled:cursor-not-allowed"
              >
                send
              </button>
            </div>
          </footer>
        </>
      )}

      {runPromptOpen && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-20"
          onClick={() => setRunPromptOpen(false)}
        >
          <div
            className="bg-black border border-cyan-500/60 rounded p-6 max-w-xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-cyan-300 tracking-widest text-sm mb-2">RUN WORKFLOW</h2>
            <p className="text-zinc-400 text-xs mb-4">
              workflow: <span className="text-zinc-200">{workflow?.name}</span>
            </p>
            <label className="text-xs text-zinc-500">task description</label>
            <textarea
              value={taskDraft}
              onChange={(e) => setTaskDraft(e.target.value)}
              rows={6}
              autoFocus
              placeholder="What should the workflow accomplish? (e.g. 'Add dark mode toggle to the settings page')"
              className="w-full mt-1 bg-black border border-cyan-500/40 rounded p-2 text-sm focus:outline-none focus:border-cyan-300"
            />
            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={() => setRunPromptOpen(false)}
                className="px-3 py-1 border border-zinc-500 text-zinc-400 hover:bg-zinc-700 text-xs tracking-wide"
              >
                cancel
              </button>
              <button
                onClick={submitRun}
                disabled={!taskDraft.trim()}
                className="px-4 py-1 border border-fuchsia-500 text-fuchsia-300 hover:bg-fuchsia-500 hover:text-black text-xs tracking-wide disabled:opacity-30"
              >
                launch
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function MessageRow({ m }: { m: ChatMessage }) {
  const labelByRole = {
    user: { label: 'YOU', color: 'text-emerald-300' },
    assistant: { label: 'AGENT', color: 'text-cyan-300' },
    system: { label: 'SYS', color: 'text-zinc-500' },
  } as const
  const { label, color } = labelByRole[m.role]
  return (
    <div className="flex gap-3">
      <span className={`${color} text-xs tracking-widest pt-0.5 w-16 shrink-0`}>{label}</span>
      <div className="flex-1">
        <p className="text-zinc-100 whitespace-pre-wrap">{m.content}</p>
        <p className="text-zinc-600 text-[10px] mt-0.5">
          {new Date(m.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  )
}
