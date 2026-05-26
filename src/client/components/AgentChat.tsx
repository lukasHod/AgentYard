import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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

const BUSY_STATES = new Set<AgentState>(['thinking', 'tool_running', 'awaiting_clarification'])

const BUSY_COLOR: Record<AgentState, string> = {
  idle: '',
  thinking: 'text-cyan-300',
  tool_running: 'text-purple-300',
  awaiting_clarification: 'text-amber-300',
  done: '',
  failed: '',
}

// Sci-fi flavour for the "agent is working" indicator. The shipyard motif is
// already established elsewhere in the UI, so these lean into it (subspace,
// telemetry, vectors). We cycle a random pick from this list every ~1.5s so
// the indicator feels alive instead of a frozen "thinking…". Twenty entries
// is enough that the user rarely sees the same word twice in one turn.
const SCI_FI_BUSY_WORDS: readonly string[] = [
  'plotting trajectory',
  'warping subspace',
  'modulating signal',
  'parsing telemetry',
  'spinning up cores',
  'scanning manifolds',
  'decrypting payload',
  'compiling matrix',
  'interpolating waypoints',
  'solving heuristics',
  'probing datastreams',
  'simulating outcomes',
  'harmonizing buffers',
  'correlating signatures',
  'negotiating handshake',
  'extrapolating vectors',
  'defragging stack',
  'realigning lattice',
  'transducing ions',
  'aligning gyros',
]

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}m ${s}s`
}

// Approximate row math for the auto-growing textarea: line-height ≈ 20px at
// our text-sm + leading-normal. Border + padding = ~10px vertical chrome.
// Five rows of text → max-height ~110px; under that, height tracks content.
const TEXTAREA_LINE_HEIGHT = 20
const TEXTAREA_CHROME = 10
const TEXTAREA_MAX_ROWS = 5
const TEXTAREA_MAX_HEIGHT = TEXTAREA_LINE_HEIGHT * TEXTAREA_MAX_ROWS + TEXTAREA_CHROME

function autoResize(el: HTMLTextAreaElement | null): void {
  if (!el) return
  // Reset to 'auto' first so scrollHeight shrinks when the user deletes text.
  el.style.height = 'auto'
  const desired = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)
  el.style.height = `${desired}px`
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
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const replyRef = useRef<HTMLTextAreaElement>(null)

  // Sticky-to-bottom state: true while the user is at (or near) the bottom of
  // the transcript. Tracked in a ref so the scroll listener doesn't trigger
  // re-renders. When true we yank the scroll back to the bottom whenever
  // content grows; when false (the user has scrolled up to read history) we
  // leave them alone.
  const stickyRef = useRef(true)
  const prevAgentRef = useRef<string | null>(null)
  const NEAR_BOTTOM_PX = 32

  const snapToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el || !stickyRef.current) return
    el.scrollTop = el.scrollHeight
  }, [])

  // Watch the user's scroll position. Once they leave the bottom we stop
  // auto-scrolling; once they come back we resume.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      stickyRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Opening the chat (or switching to a different session) → land on the
  // latest message, regardless of where the prior session was scrolled to.
  useEffect(() => {
    if (prevAgentRef.current !== agentRunId) {
      prevAgentRef.current = agentRunId
      stickyRef.current = true
    }
  }, [agentRunId])

  // Snap on every transcript / pending / state change. RAF + delayed passes
  // handle the case where rows finish laying out AFTER our first scroll —
  // each `MessageRow` uses `content-visibility: auto`, so off-screen rows
  // render at a 44px placeholder until they enter the viewport, then expand
  // to their real height and shift the layout under us.
  useLayoutEffect(() => {
    snapToBottom()
    const r = requestAnimationFrame(() => {
      snapToBottom()
      requestAnimationFrame(snapToBottom)
    })
    const t1 = window.setTimeout(snapToBottom, 80)
    const t2 = window.setTimeout(snapToBottom, 250)
    return () => {
      cancelAnimationFrame(r)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [transcript, pending, state, agentRunId, snapToBottom])

  // Catch late reflow: image loads, font swaps, virtualized rows expanding
  // when they scroll into view. ResizeObserver fires on bounding-box changes
  // of each direct child of the scroll container; MutationObserver picks up
  // newly inserted rows so we can observe them too.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(snapToBottom)
    ro.observe(el)
    for (const c of Array.from(el.children)) ro.observe(c)
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n instanceof Element) ro.observe(n)
        }
      }
      snapToBottom()
    })
    mo.observe(el, { childList: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [snapToBottom])

  // Re-measure the textareas whenever their content (or the surrounding state
  // that gates visibility) changes. useLayoutEffect avoids a flash of the old
  // height between paint and resize.
  useLayoutEffect(() => {
    autoResize(inputRef.current)
  }, [input])
  useLayoutEffect(() => {
    autoResize(replyRef.current)
  }, [reply, pending])

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

  const showBusy = state ? BUSY_STATES.has(state) : false
  // Don't double up with the pending-clarification card, which already pulses.
  const showInlineBusy = showBusy && state !== 'awaiting_clarification'

  // Turn timer: start when the agent enters a busy state, freeze when it
  // returns to idle/done/failed. We hold the start timestamp in a ref so the
  // re-render driven by `nowTick` doesn't reset it.
  const turnStartRef = useRef<number | null>(null)
  const [nowTick, setNowTick] = useState(0)
  useEffect(() => {
    if (showInlineBusy) {
      if (turnStartRef.current === null) turnStartRef.current = Date.now()
    } else {
      turnStartRef.current = null
    }
  }, [showInlineBusy])
  useEffect(() => {
    if (!showInlineBusy) return
    const id = window.setInterval(() => setNowTick((t) => t + 1), 500)
    return () => window.clearInterval(id)
  }, [showInlineBusy])
  const elapsedLabel = turnStartRef.current
    ? formatElapsed(Date.now() - turnStartRef.current)
    : '0s'

  // Cycling sci-fi word. We index from a random offset on each tick so two
  // consecutive ticks never show the same word, without making the cycle
  // order itself feel random or chaotic.
  const [wordIdx, setWordIdx] = useState(() => Math.floor(Math.random() * SCI_FI_BUSY_WORDS.length))
  useEffect(() => {
    if (!showInlineBusy) return
    const id = window.setInterval(() => {
      setWordIdx((prev) => {
        const step = 1 + Math.floor(Math.random() * (SCI_FI_BUSY_WORDS.length - 1))
        return (prev + step) % SCI_FI_BUSY_WORDS.length
      })
    }, 1500)
    return () => window.clearInterval(id)
  }, [showInlineBusy])
  const busyWord = SCI_FI_BUSY_WORDS[wordIdx] ?? 'working'
  // Reference nowTick so the elapsed counter re-renders on each interval tick.
  void nowTick

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
        {transcript.length === 0 && !pending && !showBusy && (
          <EmptyMessage>no transmissions yet.</EmptyMessage>
        )}
        {transcript.map((m) => (
          <MessageRow key={m.id} m={m} />
        ))}
        {showInlineBusy && state && (
          <div className="flex gap-3 items-center">
            <span className={`${BUSY_COLOR[state]} text-[10px] tracking-widest pt-0.5 w-12 shrink-0`}>
              {state === 'tool_running' ? 'TOOL' : 'AGENT'}
            </span>
            <div className={`${BUSY_COLOR[state]} flex items-center gap-2`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              <span className="italic">{busyWord}…</span>
              <span className="text-zinc-500 not-italic">({elapsedLabel})</span>
            </div>
          </div>
        )}
        {pending && (
          <div className="border border-amber-400/60 rounded p-3 bg-amber-500/5">
            <div className="text-amber-300 text-[10px] tracking-widest mb-2">
              » INCOMING TRANSMISSION — clarification requested
            </div>
            <div className="text-zinc-100 mb-2 whitespace-pre-wrap">{pending.question}</div>
            <div className="flex gap-2 items-start">
              <textarea
                ref={replyRef}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendReply()
                  }
                }}
                placeholder="your reply... (shift+enter for newline)"
                rows={1}
                className="flex-1 bg-black border border-amber-400/40 rounded px-2 py-1 focus:outline-none focus:border-amber-300 resize-none overflow-y-auto leading-normal"
                style={{ maxHeight: TEXTAREA_MAX_HEIGHT }}
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

      <div className="border-t border-cyan-500/30 px-3 py-2 flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={connected ? '> transmit... (shift+enter for newline)' : '> offline'}
          disabled={!connected}
          rows={1}
          className="flex-1 bg-black border border-cyan-500/40 rounded px-2 py-1 focus:outline-none focus:border-cyan-300 disabled:opacity-50 resize-none overflow-y-auto leading-normal"
          style={{ maxHeight: TEXTAREA_MAX_HEIGHT }}
        />
        <button
          onClick={send}
          disabled={!connected || !input.trim()}
          className="px-3 py-1 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black tracking-wide disabled:opacity-30 disabled:cursor-not-allowed self-stretch"
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
