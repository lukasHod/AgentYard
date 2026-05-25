import { memo, useEffect, useRef, useState } from 'react'
import type { AgentState } from '../../core/types'
import { EmptyMessage } from './ui/EmptyMessage'

export interface AgentChatMessage {
  id: string
  role: 'assistant' | 'user' | 'system'
  content: string
  timestamp: number
}

export interface AgentChatPending {
  toolUseId: string
  question: string
}

interface Props {
  agentRunId: string
  label?: string
  role?: 'leader' | 'drone' | 'free'
  state?: AgentState
  transcript: AgentChatMessage[]
  pending: AgentChatPending | null
  connected?: boolean
  onSend: (content: string) => void
  onReply: (toolUseId: string, answer: string) => void
  /** Height for the scrollable transcript area. */
  scrollHeight?: number
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

export function AgentChat({
  agentRunId,
  label,
  role,
  state,
  transcript,
  pending,
  connected = true,
  onSend,
  onReply,
  scrollHeight,
}: Props) {
  const [input, setInput] = useState('')
  const [reply, setReply] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [transcript, pending])

  function send() {
    const text = input.trim()
    if (!text) return
    onSend(text)
    setInput('')
  }

  function sendReply() {
    const text = reply.trim()
    if (!text || !pending) return
    onReply(pending.toolUseId, text)
    setReply('')
  }

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="border-b border-cyan-500/30 px-3 py-2 flex items-center justify-between text-xs">
        <div>
          {role && <span className="text-fuchsia-300 mr-2 tracking-wide">{role.toUpperCase()}</span>}
          <span className="text-cyan-200">{label ?? agentRunId.slice(0, 8)}</span>
        </div>
        {state && <span className={STATE_COLORS[state]}>// {STATE_LABELS[state]}</span>}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2 text-xs"
        style={scrollHeight ? { maxHeight: scrollHeight } : undefined}
      >
        {transcript.length === 0 && !pending && <EmptyMessage>no transmissions yet.</EmptyMessage>}
        {transcript.map((m) => (
          <MessageRow key={m.id} m={m} />
        ))}
        {pending && (
          <div className="border border-amber-400/60 rounded p-3 bg-amber-500/5">
            <div className="text-amber-300 text-[10px] tracking-widest mb-2">
              » INCOMING TRANSMISSION — clarification requested
            </div>
            <div className="text-zinc-100 mb-2 whitespace-pre-wrap">{pending.question}</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendReply()}
                placeholder="your reply..."
                className="flex-1 bg-black border border-amber-400/40 rounded px-2 py-1 focus:outline-none focus:border-amber-300"
                autoFocus
              />
              <button
                onClick={sendReply}
                className="px-3 py-1 border border-amber-400 text-amber-300 hover:bg-amber-400 hover:text-black tracking-wide"
              >
                transmit
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-cyan-500/30 px-3 py-2 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={connected ? '> transmit...' : '> offline'}
          disabled={!connected}
          className="flex-1 bg-black border border-cyan-500/40 rounded px-2 py-1 focus:outline-none focus:border-cyan-300 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!connected || !input.trim()}
          className="px-3 py-1 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black tracking-wide disabled:opacity-30 disabled:cursor-not-allowed"
        >
          send
        </button>
      </div>
    </div>
  )
}

const LABEL_BY_ROLE = {
  user: { label: 'YOU', color: 'text-emerald-300' },
  assistant: { label: 'AGENT', color: 'text-cyan-300' },
  system: { label: 'SYS', color: 'text-zinc-500' },
} as const

// `content-visibility: auto` lets the browser skip layout/paint for
// off-screen messages — a meaningful win for long-running agents where
// transcripts can grow into the hundreds.
const ROW_VIRTUALIZATION_STYLE = {
  contentVisibility: 'auto' as const,
  containIntrinsicSize: '0 44px',
}

const MessageRow = memo(function MessageRow({ m }: { m: AgentChatMessage }) {
  const { label, color } = LABEL_BY_ROLE[m.role]
  return (
    <div className="flex gap-3" style={ROW_VIRTUALIZATION_STYLE}>
      <span className={`${color} text-[10px] tracking-widest pt-0.5 w-12 shrink-0`}>{label}</span>
      <div className="flex-1">
        <p className="text-zinc-100 whitespace-pre-wrap">{m.content}</p>
        <p className="text-zinc-600 text-[10px] mt-0.5">
          {new Date(m.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  )
})
