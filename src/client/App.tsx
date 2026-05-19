import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import type { AgentState, ServerEvents } from '../core/types'

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
  thinking: 'thinking...',
  tool_running: 'tool active',
  awaiting_clarification: 'awaiting input',
  done: 'session ended',
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

let messageIdCounter = 0
function nextMessageId() {
  return `m${++messageIdCounter}`
}

export function App() {
  const [connected, setConnected] = useState(false)
  const [state, setState] = useState<AgentState>('idle')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pending, setPending] = useState<PendingClarification | null>(null)
  const [input, setInput] = useState('')
  const [reply, setReply] = useState('')
  const socketRef = useRef<Socket | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const socket: Socket = io({ transports: ['websocket', 'polling'] })
    socketRef.current = socket
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socket.on('agent:message', (m: ServerEvents['agent:message']) => {
      setMessages((prev) => [
        ...prev,
        { role: m.role, content: m.content, timestamp: m.timestamp, id: nextMessageId() },
      ])
    })

    socket.on('agent:state', (s: ServerEvents['agent:state']) => {
      setState(s.state)
    })

    socket.on('clarification:requested', (c: ServerEvents['clarification:requested']) => {
      setPending({ toolUseId: c.toolUseId, question: c.question })
    })

    socket.on('clarification:resolved', () => {
      setPending(null)
      setReply('')
    })

    return () => {
      socket.close()
    }
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, pending])

  function send() {
    const text = input.trim()
    if (!text) return
    socketRef.current?.emit('agent:send', { content: text })
    setInput('')
  }

  function sendReply() {
    const text = reply.trim()
    if (!text || !pending) return
    socketRef.current?.emit('clarification:reply', { toolUseId: pending.toolUseId, answer: text })
  }

  return (
    <main className="min-h-screen flex flex-col font-mono">
      <header className="border-b border-cyan-500/30 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
          <h1 className="text-cyan-300 tracking-[0.3em] text-sm">AGENTYARD</h1>
          <span className="text-zinc-600 text-xs">phase 1 / single session</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className={connected ? 'text-emerald-400' : 'text-amber-400'}>
            {connected ? '◉ link' : '○ offline'}
          </span>
          <span className={STATE_COLORS[state]}>// {STATE_LABELS[state]}</span>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-4 space-y-3 text-sm"
      >
        {messages.length === 0 && (
          <p className="text-zinc-600 italic">
            // session is open. type a message to begin transmission.
          </p>
        )}
        {messages.map((m) => (
          <MessageRow key={m.id} m={m} />
        ))}
        {pending && (
          <div className="border border-amber-400/60 rounded p-4 bg-amber-500/5">
            <div className="text-amber-300 text-xs tracking-widest mb-2">
              » INCOMING TRANSMISSION — clarification requested
            </div>
            <div className="text-zinc-100 mb-3 whitespace-pre-wrap">{pending.question}</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendReply()
                }}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) send()
            }}
            placeholder="> transmit to agent..."
            disabled={!connected}
            className="flex-1 bg-black border border-cyan-500/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-cyan-300 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!connected || !input.trim()}
            className="px-4 py-2 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black text-xs tracking-wide disabled:opacity-30 disabled:cursor-not-allowed"
          >
            send
          </button>
        </div>
      </footer>
    </main>
  )
}

function MessageRow({ m }: { m: ChatMessage }) {
  const labelByRole = {
    user: { label: 'YOU',   color: 'text-emerald-300' },
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
