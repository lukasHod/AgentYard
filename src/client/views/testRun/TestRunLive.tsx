import type { ReactNode, RefObject } from 'react'
import type { AgentRole, AgentState, SessionDescriptor } from '../../../core/types'
import type { WorkflowNode } from '../../../core/schema'
import { SYSTEM_TAB_ID } from './types'
import type {
  ChatMessage,
  NodeProgressEntry,
  PendingClarification,
  TestRunStage,
} from './useTestRunSocket'

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

export function TestRunLive(props: {
  stage: TestRunStage
  sessions: SessionDescriptor[]
  transcripts: Map<string, ChatMessage[]>
  pendings: Map<string, PendingClarification>
  nodeProgress: NodeProgressEntry[]
  scriptOutputs: Map<string, string>
  customNodes: Map<string, WorkflowNode>
  finalSummary: string | null
  error: string | null
  selectedTab: string
  setSelectedTab: (id: string) => void
  scrollRef: RefObject<HTMLDivElement>
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
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 flex items-center gap-1.5 text-[11px] border-r border-fuchsia-500/30 whitespace-nowrap ${
        active ? 'bg-fuchsia-500/10 text-fuchsia-100' : 'text-zinc-400 hover:bg-zinc-800/40'
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
  stage: TestRunStage
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
            <span className="text-zinc-500 text-[10px] truncate max-w-[400px]">{e.summary}</span>
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
  pending: PendingClarification | null
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
  const label = m.role === 'user' ? 'YOU' : m.role === 'assistant' ? 'AGENT' : 'SYS'
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
