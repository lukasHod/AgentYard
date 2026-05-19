/**
 * Phase 3 smoke test:
 *   1. Reset any prior state.
 *   2. Fetch default workflow.
 *   3. POST /api/runs with a small task.
 *   4. Watch the run lifecycle (run:started → node:started/complete × N → run:complete).
 *   5. Verify each node spawned a leader session.
 *
 * Run with: npx tsx scripts/smoke.ts
 * (Assumes `npm run dev` is already running.)
 */
import { io } from 'socket.io-client'

const TIMEOUT_MS = 300_000 // 5 min — three Claude turns sequentially.
const BASE = 'http://localhost:4242'
const TASK = 'Add a "back to top" button to a long article page.'

function fail(msg: string): never {
  console.error(`[smoke] FAIL: ${msg}`)
  process.exit(1)
}

const nodeStarted = new Set<string>()
const nodeComplete = new Set<string>()
const leaderLabels = new Set<string>()
let runId: string | null = null
let finalSummary: string | null = null
let runFailed: string | null = null

// Reset.
await fetch(`${BASE}/api/runs/reset`, { method: 'POST' }).catch(() => {})

// Workflow lookup.
const wfList = await fetch(`${BASE}/api/workflows`).then((r) => r.json())
if (!Array.isArray(wfList) || wfList.length === 0) fail('no workflows available')
const wf = wfList[0]
console.log(`[smoke] using workflow #${wf.id} "${wf.name}" with ${wf.graph.nodes.length} nodes`)

const socket = io(BASE, { transports: ['websocket'] })

const done = new Promise<void>((resolve, reject) => {
  socket.on('connect', async () => {
    console.log('[smoke] connected, kicking off run')
    const res = await fetch(`${BASE}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: wf.id, task: TASK }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      reject(new Error(`POST /api/runs -> ${res.status}: ${JSON.stringify(j)}`))
    }
  })

  socket.on('run:started', (ev: { runId: string; nodeIds: string[] }) => {
    runId = ev.runId
    console.log(`[smoke] run:started ${ev.runId} nodes=${ev.nodeIds.join(',')}`)
  })

  socket.on('node:started', (ev: { nodeId: string; title: string }) => {
    nodeStarted.add(ev.nodeId)
    console.log(`[smoke] node:started ${ev.nodeId} (${ev.title})`)
  })

  socket.on(
    'node:complete',
    (ev: { nodeId: string; title: string; summary: string }) => {
      nodeComplete.add(ev.nodeId)
      console.log(`[smoke] node:complete ${ev.nodeId} -> ${ev.summary.slice(0, 100).replace(/\n/g, ' ')}`)
    },
  )

  socket.on('session:added', (s: { role: string; label?: string }) => {
    if (s.role === 'leader' && s.label) leaderLabels.add(s.label)
  })

  socket.on('run:complete', (ev: { finalSummary: string }) => {
    finalSummary = ev.finalSummary
    console.log(`[smoke] run:complete final="${ev.finalSummary.slice(0, 120).replace(/\n/g, ' ')}…"`)
    resolve()
  })

  socket.on('run:failed', (ev: { error: string }) => {
    runFailed = ev.error
    reject(new Error(`run:failed ${ev.error}`))
  })
})

const timeout = setTimeout(
  () =>
    fail(
      `timeout after ${TIMEOUT_MS}ms; run=${runId} started=${[...nodeStarted].join(',')} complete=${[...nodeComplete].join(',')} fail=${runFailed}`,
    ),
  TIMEOUT_MS,
)
try {
  await done
} catch (e) {
  fail(String(e))
}
clearTimeout(timeout)

// Post-checks
if (!runId) fail('no run id')
if (!finalSummary) fail('no final summary')
const expectedNodes = wf.graph.nodes.map((n: { id: string }) => n.id)
for (const id of expectedNodes) {
  if (!nodeComplete.has(id)) fail(`node ${id} never completed`)
}
if (leaderLabels.size < expectedNodes.length) {
  fail(`expected ${expectedNodes.length} leader sessions, saw ${leaderLabels.size}: ${[...leaderLabels].join(',')}`)
}

console.log(`[smoke] PASS — ${nodeComplete.size}/${expectedNodes.length} nodes complete; leaders=${[...leaderLabels].join(',')}`)
socket.close()
process.exit(0)
