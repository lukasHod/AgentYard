/**
 * Phase D smoke — sandbox test-run endpoint.
 *
 * Flow:
 *  1. Create a throwaway git repo.
 *  2. Register it as a ship.
 *  3. POST /api/test-runs against the default workflow's `print-context`
 *     script node, scope='node' (so we don't burn API calls on real AI).
 *  4. Listen on socket.io for test-run:* events scoped to that testRunId.
 *  5. Wait for test-run:teardown, then verify:
 *     - test-run:started, test-run:node:started, test-run:node:complete,
 *       test-run:complete, test-run:teardown all fired
 *     - The test-worktree directory was deleted from disk
 *     - The throwaway branch is gone from `git branch --list`
 *
 * Run with: npx tsx scripts/smoke-test-run.ts
 * (Assumes `npm run dev` is already running.)
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { io, type Socket } from 'socket.io-client'

const BASE = 'http://localhost:4242'
const TIMEOUT_MS = 60_000

interface CheckResult {
  name: string
  pass: boolean
  detail?: string
}

const results: CheckResult[] = []
let shipId: number | null = null
let socket: Socket | null = null
const repoPath = path.join(tmpdir(), `agentyard-smoke-D-${Date.now()}`)

async function cleanup() {
  if (socket) socket.close()
  if (shipId !== null) {
    await fetch(`${BASE}/api/ships/${shipId}`, { method: 'DELETE' }).catch(() => {})
  }
  if (existsSync(repoPath)) rmSync(repoPath, { recursive: true, force: true })
}

function fail(msg: string): never {
  console.error(`[smoke-D] FAIL setup: ${msg}`)
  void cleanup().finally(() => process.exit(1))
  setTimeout(() => process.exit(1), 5_000)
  throw new Error(msg)
}

// 1. Throwaway repo.
mkdirSync(repoPath, { recursive: true })
const git = simpleGit(repoPath)
await git.init()
await git.addConfig('user.email', 'smoke@agentyard.test')
await git.addConfig('user.name', 'AgentYard Smoke')
writeFileSync(path.join(repoPath, 'README.md'), '# smoke D\n', 'utf8')
await git.add('.')
await git.commit('initial')
try {
  await git.raw(['branch', '-M', 'main'])
} catch {
  // ignore — older git
}

// 2. Register ship.
{
  const r = await fetch(`${BASE}/api/ships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `smoke-D-${Date.now()}`, projectPath: repoPath }),
  })
  if (!r.ok) fail(`create ship: HTTP ${r.status}`)
  const ship = (await r.json()) as { id?: number }
  shipId = ship.id ?? null
  if (typeof shipId !== 'number') fail(`create ship: no id in response`)
}

// 3. Find default workflow + print-context node.
const wfList = (await fetch(`${BASE}/api/workflows`).then((r) => r.json())) as Array<{
  id: number
  graph: { nodes: Array<{ id: string; type: string }> }
}>
const wf = wfList.find((w) => w.graph.nodes.find((n) => n.id === 'print-context'))
if (!wf) fail('no workflow with print-context node')
const workflowId: number = wf!.id

// 4. Open socket.io and start collecting events.
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

// 5. POST the test-run.
{
  const r = await fetch(`${BASE}/api/test-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shipId,
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

// 6. Wait for teardown (or timeout).
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

// 7. Structural checks.
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

// 8. Worktree dir gone.
const wtRoot = path.join(repoPath, '.agentyard', 'test-worktrees')
const wtChildren = existsSync(wtRoot) ? readdirSync(wtRoot) : []
results.push({
  name: 'sandbox worktree dir removed from disk',
  pass: wtChildren.length === 0,
  detail: wtChildren.length === 0 ? undefined : `leftover dirs: ${wtChildren.join(', ')}`,
})

// 9. Throwaway branch gone.
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
