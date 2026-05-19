/**
 * Phase 4 smoke test:
 *   1. Create a custom skill that mandates a sentinel token.
 *   2. Refresh skills.
 *   3. Attach the skill to the develop node of the default workflow.
 *   4. Run the workflow.
 *   5. Verify the implementer drone's transcript contains the sentinel —
 *      proves the skill body was injected into the drone's system prompt.
 *   6. Restore the workflow.
 *
 * Run with: npx tsx scripts/smoke.ts
 * (Assumes `npm run dev` is already running.)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { io } from 'socket.io-client'

const TIMEOUT_MS = 300_000
const BASE = 'http://localhost:4242'
const TASK = 'Add a "back to top" button to a long article page.'
const SENTINEL = 'AGENTYARD_SKILL_SENTINEL_42'
const TEST_SKILL_NAME = 'agentyard-smoke-test'

function fail(msg: string): never {
  console.error(`[smoke] FAIL: ${msg}`)
  process.exit(1)
}

// 1. Write the test skill file.
const skillsDir = path.join(homedir(), '.agentyard', 'skills', TEST_SKILL_NAME)
mkdirSync(skillsDir, { recursive: true })
writeFileSync(
  path.join(skillsDir, 'SKILL.md'),
  `---
name: ${TEST_SKILL_NAME}
description: AgentYard smoke test marker — drones with this skill MUST emit a sentinel token.
---

# Smoke-test sentinel skill

Whenever you respond to the leader, you MUST include the literal token \`${SENTINEL}\` somewhere in your response. This is a sanity check that this skill's body was loaded into your system prompt.
`,
  'utf8',
)
console.log(`[smoke] wrote test skill to ${skillsDir}`)

// 2. Refresh skills.
const skills = await fetch(`${BASE}/api/skills/refresh`, { method: 'POST' }).then((r) => r.json())
if (!Array.isArray(skills)) fail('refresh did not return an array')
const found = skills.find((s: { name: string }) => s.name === TEST_SKILL_NAME)
if (!found) fail(`test skill ${TEST_SKILL_NAME} not found after refresh`)
console.log(`[smoke] skills refreshed (${skills.length}) — found test skill`)

// 3. Snapshot + patch develop node skills.
const wfs = await fetch(`${BASE}/api/workflows`).then((r) => r.json())
const wf = wfs[0]
const originalSkills = wf.graph.nodes.find((n: { id: string }) => n.id === 'develop').skills.slice()
const patchedNodes = wf.graph.nodes.map((n: { id: string; skills: string[] }) =>
  n.id === 'develop' ? { ...n, skills: [...new Set([...n.skills, TEST_SKILL_NAME])] } : n,
)
const putRes = await fetch(`${BASE}/api/workflows/${wf.id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ graph: { ...wf.graph, nodes: patchedNodes } }),
})
if (!putRes.ok) fail(`PUT /api/workflows/${wf.id} -> ${putRes.status}`)
console.log(`[smoke] attached ${TEST_SKILL_NAME} to develop`)

// Restore-original helper, called from finally.
async function restoreWorkflow() {
  const wfNow = await fetch(`${BASE}/api/workflows/${wf.id}`).then((r) => r.json())
  const restoredNodes = wfNow.graph.nodes.map((n: { id: string }) =>
    n.id === 'develop' ? { ...n, skills: originalSkills } : n,
  )
  await fetch(`${BASE}/api/workflows/${wf.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph: { ...wfNow.graph, nodes: restoredNodes } }),
  })
  console.log('[smoke] restored develop.skills')
}

// 4. Reset + kick off run.
await fetch(`${BASE}/api/runs/reset`, { method: 'POST' }).catch(() => {})

const socket = io(BASE, { transports: ['websocket'] })
let implementerId: string | null = null
let sentinelSeen = false
let runComplete = false

const done = new Promise<void>((resolve, reject) => {
  socket.on('connect', async () => {
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

  socket.on('session:added', (s: { id: string; label?: string }) => {
    if (s.label === 'develop/implementer') {
      implementerId = s.id
      console.log(`[smoke] implementer session: ${s.id}`)
    }
  })

  socket.on(
    'agent:message',
    (m: { agentRunId: string; role: string; content: string }) => {
      if (m.agentRunId === implementerId && m.role === 'assistant') {
        if (m.content.includes(SENTINEL)) {
          sentinelSeen = true
          console.log('[smoke] ✓ sentinel observed in implementer transcript')
        }
      }
    },
  )

  socket.on('run:complete', () => {
    runComplete = true
    resolve()
  })

  socket.on('run:failed', (ev: { error: string }) =>
    reject(new Error(`run:failed ${ev.error}`)),
  )
})

const timeout = setTimeout(
  () =>
    fail(
      `timeout ${TIMEOUT_MS}ms (impl=${implementerId} sentinel=${sentinelSeen} runComplete=${runComplete})`,
    ),
  TIMEOUT_MS,
)
try {
  await done
} catch (e) {
  await restoreWorkflow().catch(() => {})
  fail(String(e))
}
clearTimeout(timeout)

await restoreWorkflow()

if (!implementerId) fail('implementer session never appeared')
if (!sentinelSeen) fail('sentinel was not present in implementer response — skill not injected')
if (!runComplete) fail('run did not complete')

console.log('[smoke] PASS — skill body reached the implementer drone')
socket.close()
process.exit(0)
