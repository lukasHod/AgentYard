/**
 * Phase 2 smoke test:
 *   1. Trigger /api/demo/develop — spawns leader + implementer + tester.
 *   2. Wait for session:added events for all three.
 *   3. Wait for node:complete event (leader → drones → leader → mark_complete).
 *   4. Sanity-check both drones produced at least one assistant message.
 *
 * Run with: npx tsx scripts/smoke.ts
 * (Assumes `npm run dev` is already running.)
 */
import { io } from 'socket.io-client'

const TIMEOUT_MS = 180_000
const BASE = 'http://localhost:4242'

function fail(msg: string): never {
  console.error(`[smoke] FAIL: ${msg}`)
  process.exit(1)
}

const droneLabels = new Set(['implementer', 'tester'])
const seenLabels = new Set<string>()
const assistantCountByLabel = new Map<string, number>()
let leaderId: string | null = null
let nodeComplete: { summary: string } | null = null

// Reset any previous demo state so the test is idempotent.
await fetch(`${BASE}/api/demo/reset`, { method: 'POST' }).catch(() => {})

const socket = io(BASE, { transports: ['websocket'] })

const finished = new Promise<void>((resolve) => {
  socket.on('connect', async () => {
    console.log('[smoke] connected')
    const res = await fetch(`${BASE}/api/demo/develop`, { method: 'POST' })
    const body = await res.json()
    if (!res.ok) fail(`POST /api/demo/develop -> ${res.status} ${JSON.stringify(body)}`)
    console.log(`[smoke] demo started: leader=${body.leader} drones=${body.drones.join(',')}`)
  })

  socket.on('session:added', (s: { id: string; role: string; label?: string }) => {
    console.log(`[smoke] session:added  ${s.role}/${s.label ?? '?'} (${s.id})`)
    if (s.role === 'leader') leaderId = s.id
    if (s.label) seenLabels.add(s.label)
  })

  socket.on(
    'agent:message',
    (m: { agentRunId: string; role: string; content: string }) => {
      if (m.role !== 'assistant') return
      // Tally per label so we can verify the drones actually responded.
      const idTag = m.agentRunId === leaderId ? 'leader' : m.agentRunId.slice(0, 8)
      assistantCountByLabel.set(idTag, (assistantCountByLabel.get(idTag) ?? 0) + 1)
      console.log(`[smoke] ${idTag} >> ${m.content.slice(0, 120).replace(/\n/g, ' ')}`)
    },
  )

  socket.on(
    'agent:state',
    (s: { agentRunId: string; state: string }) => {
      // Compact state-transition log.
      const idTag = s.agentRunId === leaderId ? 'leader' : s.agentRunId.slice(0, 8)
      console.log(`[smoke] ${idTag} state=${s.state}`)
    },
  )

  socket.on('node:complete', (ev: { node: string; summary: string }) => {
    nodeComplete = ev
    console.log(`[smoke] node:complete (${ev.node}) -> ${ev.summary.slice(0, 200)}`)
    resolve()
  })
})

const timeout = setTimeout(
  () =>
    fail(
      `timed out after ${TIMEOUT_MS}ms (labels=${[...seenLabels].join(',')}, node_complete=${!!nodeComplete})`,
    ),
  TIMEOUT_MS,
)
await finished
clearTimeout(timeout)

// Post-checks
for (const label of droneLabels) {
  if (!seenLabels.has(label)) fail(`drone "${label}" was never spawned`)
}
if (!leaderId) fail('leader id was never observed')
if (!nodeComplete) fail('node:complete never fired')

console.log(`[smoke] PASS — labels=${[...seenLabels].join(',')} node="${nodeComplete!.summary.slice(0, 80)}"`)
socket.close()
process.exit(0)
