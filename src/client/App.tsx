import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import type { AgentRole, AgentState, ServerEvents, SessionDescriptor } from '../core/types'

interface ChatMessage {
  role: 'assistant' | 'user' | 'system'
  content: string
  timestamp: number
  id: string
}

interface PendingClarification {
  toolUseId: string
  question: string
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

let messageIdCounter = 0
const nextMessageId = () => `m${++messageIdCounter}`

export function App() {
  const [connected, setConnected] = useState(false)
  const [sessions, setSessions] = useState<Map<string, SessionDescriptor>>(new Map())
  const [transcripts, setTranscripts] = useState<Map<string, ChatMessage[]>>(new Map())
  const [pendings, setPendings] = useState<Map<string, PendingClarification>>(new Map())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [reply, setReply] = useState('')
  const [nodeComplete, setNodeComplete] = useState<ServerEvents['node:complete'] | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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
      if (list.length > 0) setSelectedId((cur) => cur ?? list[0]!.id)
    })

    socket.on('session:added', (s: ServerEvents['session:added']) => {
      setSessions((prev) => new Map(prev).set(s.id, s))
      setSelectedId((cur) => cur ?? s.id)
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

    socket.on('node:complete', (ev: ServerEvents['node:complete']) => {
      setNodeComplete(ev)
    })

    return () => {
      socket.close()
    }
  }, [pushMessage])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [selectedId, transcripts, pendings])

  // Reset input fields when switching tabs.
  useEffect(() => {
    setInput('')
    setReply('')
  }, [selectedId])

  const sessionList = useMemo(() => Array.from(sessions.values()), [sessions])
  const selectedSession = selectedId ? sessions.get(selectedId) : undefined
  const selectedTranscript = selectedId ? transcripts.get(selectedId) ?? [] : []
  const selectedPending = selectedId ? pendings.get(selectedId) ?? null : null

  async function startDevelopDemo() {
    try {
      const res = await fetch('/api/demo/develop', { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Failed: ${j.error ?? res.status}`)
      }
    } catch (e) {
      alert(`Network error: ${e}`)
    }
  }

  async function resetDemo() {
    await fetch('/api/demo/reset', { method: 'POST' }).catch(() => {})
    setSessions(new Map())
    setTranscripts(new Map())
    setPendings(new Map())
    setSelectedId(null)
    setNodeComplete(null)
  }

  function send() {
    const text = input.trim()
    if (!text || !selectedId) return
    socketRef.current?.emit('agent:send', { agentRunId: selectedId, content: text })
    setInput('')
  }

  function sendReply() {
    const text = reply.trim()
    if (!text || !selectedPending || !selectedId) return
    socketRef.current?.emit('clarification:reply', {
      agentRunId: selectedId,
      toolUseId: selectedPending.toolUseId,
      answer: text,
    })
  }

  return (
    <main className="min-h-screen flex flex-col font-mono">
      <header className="border-b border-cyan-500/30 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
          <h1 className="text-cyan-300 tracking-[0.3em] text-sm">AGENTYARD</h1>
          <span className="text-zinc-600 text-xs">phase 2 / multi-agent</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={startDevelopDemo}
            disabled={!connected}
            className="px-3 py-1 border border-fuchsia-500 text-fuchsia-300 hover:bg-fuchsia-500 hover:text-black tracking-wide disabled:opacity-30"
          >
            ▶ start develop demo
          </button>
          <button
            onClick={resetDemo}
            disabled={!connected}
            className="px-3 py-1 border border-zinc-500 text-zinc-400 hover:bg-zinc-700 tracking-wide disabled:opacity-30"
          >
            reset
          </button>
          <span className={connected ? 'text-emerald-400' : 'text-amber-400'}>
            {connected ? '◉ link' : '○ offline'}
          </span>
        </div>
      </header>

      {sessionList.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
          // no agents online. click <span className="mx-1 text-fuchsia-400">start develop demo</span> to spawn a leader + 2 drones.
        </div>
      ) : (
        <>
          <nav className="border-b border-cyan-500/20 px-4 flex items-center overflow-x-auto">
            {sessionList.map((s) => {
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
              <p className="text-zinc-600 italic text-xs">
                // viewing {selectedSession.role} agent &quot;{selectedSession.label ?? selectedSession.id}&quot; — id {selectedSession.id}
              </p>
            )}
            {selectedTranscript.length === 0 && (
              <p className="text-zinc-600 italic">// no transmissions yet.</p>
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
            {nodeComplete && (
              <div className="border border-emerald-400/50 rounded p-4 bg-emerald-500/5">
                <div className="text-emerald-300 text-xs tracking-widest mb-1">
                  ✓ NODE COMPLETE — {nodeComplete.node}
                </div>
                <div className="text-zinc-100 whitespace-pre-wrap">{nodeComplete.summary}</div>
                {nodeComplete.outputs && (
                  <pre className="text-xs text-zinc-500 mt-2 overflow-x-auto">
                    {JSON.stringify(nodeComplete.outputs, null, 2)}
                  </pre>
                )}
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
    </main>
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
