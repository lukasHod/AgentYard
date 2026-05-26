/**
 * Phase D smoke — sandbox test-run endpoint.
 *
 * Runs against the existing "smoke-planet" planet (must point at a real git
 * repo, e.g. the AgentYard repo itself). The smoke does NOT create or delete
 * the planet; pre-flight just verifies one exists.
 *
 * Flow:
 *  1. Find the "smoke-planet" via /api/planets.
 *  2. POST /api/test-runs against the default workflow's `print-context`
 *     script node, scope='node' (no real AI calls).
 *  3. Listen on socket.io for test-run:* events scoped to that testRunId.
 *  4. Wait for test-run:teardown, then verify:
 *     - test-run:started, test-run:node:started, test-run:node:complete,
 *       test-run:complete, test-run:teardown all fired
 *     - The test-worktree directory was deleted from <planetPath>/.agentyard/test-worktrees/
 *     - The throwaway agentyard-test/* branch is gone from `git branch --list`
 *
 * Run with: npx tsx scripts/smoke-test-run.ts
 * (Assumes `npm run dev` is already running and a "smoke-planet" exists.)
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { io, type Socket } from 'socket.io-client'

const BASE = 'http://localhost:4242'
const PLANET_NAME = 'smoke-planet'
const TIMEOUT_MS = 60_000

interface CheckResult {
  name: string
  pass: boolean
  detail?: string
}

interface Planet {
  id: number
  name: string
  projectPath: string
  pathExists: boolean
}

const results: CheckResult[] = []
let socket: Socket | null = null

async function cleanup() {
  if (socket) socket.close()
}

function fail(msg: string): never {
  console.error(`[smoke-D] FAIL setup: ${msg}`)
  void cleanup().finally(() => process.exit(1))
  setTimeout(() => process.exit(1), 5_000)
  throw new Error(msg)
}

// 1. Look up the existing smoke-planet.
const planets = (await fetch(`${BASE}/api/planets`).then((r) => r.json())) as Planet[]
const planet = planets.find((s) => s.name === PLANET_NAME)
if (!planet) {
  fail(
    `no planet named "${PLANET_NAME}" registered. Create one pointing at any git repo via the galaxy view first.`,
  )
}
if (!planet!.pathExists) {
  fail(`planet "${PLANET_NAME}" projectPath does not exist on disk: ${planet!.projectPath}`)
}
const planetId = planet!.id
const planetPath = planet!.projectPath
const git = simpleGit(planetPath)

// 2. Find default workflow + print-context node.
const wfList = (await fetch(`${BASE}/api/workflows`).then((r) => r.json())) as Array<{
  id: number
  graph: { nodes: Array<{ id: string; type: string }> }
}>
const wf = wfList.find((w) => w.graph.nodes.find((n) => n.id === 'print-context'))
if (!wf) fail('no workflow with print-context node')
const workflowId: number = wf!.id

// 3. Open socket.io and start collecting events.
socket = io(BASE, { transports: ['websocket', 'polling'] })
await new Promise<void>((resolve) => socket!.on('connect', () => resolve()))

const seen = new Set<string>()
let observedRunId: string | null = null
let teardownPromiseResolve: (() => void) | null = null
const teardownPromise = new Promise<void>((resolve) => {
  teardownPromiseResolve = resolve
})

function bind<T extends { testRunId: string }>(name: string) {
  socket!.on(name, (ev: T) => {
    if (observedRunId && ev.testRunId !== observedRunId) return
    seen.add(name)
    if (name === 'test-run:teardown') teardownPromiseResolve?.()
  })
}
bind('test-run:started')
bind('test-run:node:started')
bind('test-run:node:complete')
bind('test-run:complete')
bind('test-run:failed')
bind('test-run:teardown')

// 4. POST the test-run.
{
  const r = await fetch(`${BASE}/api/test-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      planetId,
      workflowId,
      task: 'smoke',
      scope: 'node',
      nodeId: 'print-context',
      upstreamOutputs: 'SMOKE_UPSTREAM',
    }),
  })
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    fail(`test-runs POST: ${(body as { error?: string }).error ?? r.status}`)
  }
  const body = (await r.json()) as { ok: boolean; testRunId: string }
  observedRunId = body.testRunId
}

// 5. Wait for teardown (or timeout).
const teardownReached = await Promise.race([
  teardownPromise.then(() => true),
  new Promise<boolean>((resolve) => setTimeout(() => resolve(false), TIMEOUT_MS)),
])

if (!teardownReached) {
  results.push({
    name: 'test-run reached teardown within timeout',
    pass: false,
    detail: `seen events: ${[...seen].join(', ')}`,
  })
} else {
  results.push({ name: 'test-run reached teardown within timeout', pass: true })
}

// 6. Structural checks.
for (const ev of [
  'test-run:started',
  'test-run:node:started',
  'test-run:node:complete',
  'test-run:complete',
  'test-run:teardown',
]) {
  results.push({
    name: `socket event fired: ${ev}`,
    pass: seen.has(ev),
    detail: seen.has(ev) ? undefined : `not seen (saw: ${[...seen].join(', ')})`,
  })
}

results.push({
  name: 'test-run:failed did NOT fire',
  pass: !seen.has('test-run:failed'),
  detail: seen.has('test-run:failed') ? 'unexpected test-run:failed' : undefined,
})

// 7. Worktree dir gone under the smoke-planet.
const wtRoot = path.join(planetPath, '.agentyard', 'test-worktrees')
const wtChildren = existsSync(wtRoot) ? readdirSync(wtRoot) : []
results.push({
  name: 'sandbox worktree dir removed from disk',
  pass: wtChildren.length === 0,
  detail: wtChildren.length === 0 ? undefined : `leftover dirs: ${wtChildren.join(', ')}`,
})

// 8. Throwaway branch gone from the smoke-planet's repo.
const branchList = (await git.branch()).all
const leftoverBranches = branchList.filter((b) => b.startsWith('agentyard-test/'))
results.push({
  name: 'agentyard-test/* branch deleted',
  pass: leftoverBranches.length === 0,
  detail: leftoverBranches.length === 0 ? undefined : `leftover: ${leftoverBranches.join(', ')}`,
})

await cleanup()

let allPass = true
for (const r of results) {
  if (r.pass) console.log(`[smoke-D] PASS  ${r.name}`)
  else {
    console.log(`[smoke-D] FAIL  ${r.name}\n        ${r.detail}`)
    allPass = false
  }
}
process.exit(allPass ? 0 : 1)
