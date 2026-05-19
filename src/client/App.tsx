import { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import type { ServerEvents } from '../core/types'

type Ping = ServerEvents['ping']

export function App() {
  const [connected, setConnected] = useState(false)
  const [lastPing, setLastPing] = useState<Ping | null>(null)
  const [health, setHealth] = useState<unknown>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }))

    const socket: Socket = io({ transports: ['websocket', 'polling'] })
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('ping', (p: Ping) => setLastPing(p))
    return () => {
      socket.close()
    }
  }, [])

  return (
    <main className="min-h-screen flex items-center justify-center font-mono">
      <div className="border border-cyan-500/40 rounded p-8 max-w-lg w-full">
        <h1 className="text-2xl tracking-wide text-cyan-300 mb-2">AGENTYARD</h1>
        <p className="text-zinc-400 text-sm mb-6">Phase 0 — scaffolding online.</p>
        <dl className="text-sm space-y-2">
          <div className="flex justify-between">
            <dt className="text-zinc-500">Socket</dt>
            <dd className={connected ? 'text-emerald-400' : 'text-amber-400'}>
              {connected ? 'connected' : 'connecting…'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Last ping</dt>
            <dd className="text-zinc-200">
              {lastPing ? `#${lastPing.count} @ ${new Date(lastPing.at).toLocaleTimeString()}` : '—'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Health</dt>
            <dd className="text-zinc-200">{health ? JSON.stringify(health) : '…'}</dd>
          </div>
        </dl>
      </div>
    </main>
  )
}
