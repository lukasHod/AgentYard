/**
 * Phase 5 smoke test:
 *   1. Create a throwaway git repo in os.tmpdir().
 *   2. POST /api/ships to register it.
 *   3. POST /api/ships/:id/features with a concrete file-writing task.
 *   4. Wait for the feature to reach status=complete (via socket events).
 *   5. Verify the worktree exists and contains the expected file.
 *
 * Run with: npx tsx scripts/smoke.ts
 * (Assumes `npm run dev` is already running.)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { io } from 'socket.io-client'

const BASE = 'http://localhost:4242'
const TIMEOUT_MS = 600_000 // 10 min — three nodes with real file work.
const SENTINEL_FILE = 'hello-agentyard.txt'
const SENTINEL_CONTENT = 'hello, agentyard'
const TASK = `Create a file named ${SENTINEL_FILE} at the repo root containing exactly the text "${SENTINEL_CONTENT}" (no surrounding quotes, no trailing newline required). The deploy phase must commit this change.`

function fail(msg: string): never {
  console.error(`[smoke] FAIL: ${msg}`)
  process.exit(1)
}

// 1. Throwaway repo.
const repoPath = path.join(tmpdir(), `agentyard-smoke-${Date.now()}`)
mkdirSync(repoPath, { recursive: true })
const git = simpleGit(repoPath)
await git.init()
await git.addConfig('user.email', 'smoke@agentyard.test')
await git.addConfig('user.name', 'AgentYard Smoke')
writeFileSync(path.join(repoPath, 'README.md'), '# Smoke test repo\n', 'utf8')
await git.add('.')
await git.commit('initial')
// Ensure a default branch named main.
try {
  await git.raw(['branch', '-M', 'main'])
} catch {
  // ignore — older git versions
}
console.log(`[smoke] created repo: ${repoPath}`)

async function cleanup() {
  // Tear down agent sessions first so they release worktree file handles.
  try {
    await fetch(`${BASE}/api/runs/reset`, { method: 'POST' })
  } catch {
    // ignore
  }
  // Delete the ship row so the cockpit isn't littered with broken smoke ships.
  if (ship?.id) {
    try {
      await fetch(`${BASE}/api/ships/${ship.id}`, { method: 'DELETE' })
    } catch {
      // ignore
    }
  }
  await new Promise((r) => setTimeout(r, 1500))
  try {
    rmSync(repoPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    console.log('[smoke] cleaned up temp repo')
  } catch (e) {
    console.warn(`[smoke] cleanup warning (orphan temp dir at ${repoPath}): ${e}`)
  }
}

// 2. Reset and create a ship.
await fetch(`${BASE}/api/runs/reset`, { method: 'POST' }).catch(() => {})
// Distinctive name with timestamp so leftover rows are obviously test artifacts.
const shipName = `smoke-throwaway-${Date.now()}`
const shipRes = await fetch(`${BASE}/api/ships`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: shipName, projectPath: repoPath }),
})
if (!shipRes.ok) {
  const j = await shipRes.json().catch(() => ({}))
  await cleanup()
  fail(`POST /api/ships -> ${shipRes.status}: ${JSON.stringify(j)}`)
}
const ship = await shipRes.json()
console.log(`[smoke] created ship #${ship.id}`)

// 3. Subscribe to events, then create feature.
const socket = io(BASE, { transports: ['websocket'] })
let featureId: number | null = null
let featureComplete = false
let featureError: string | null = null
let worktreePath: string | null = null

const done = new Promise<void>((resolve, reject) => {
  socket.on('connect', async () => {
    const res = await fetch(`${BASE}/api/ships/${ship.id}/features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'add-greeting', task: TASK }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      reject(new Error(`POST /api/ships/${ship.id}/features -> ${res.status}: ${JSON.stringify(j)}`))
      return
    }
    const body = await res.json()
    featureId = body.feature.id
    worktreePath = body.feature.worktreePath
    console.log(`[smoke] feature #${featureId} created; worktree=${worktreePath ?? '(pending)'}`)
  })

  socket.on('feature:updated', (f: { id: number; status: string; worktreePath?: string; error?: string; finalSummary?: string }) => {
    if (f.id !== featureId) return
    if (f.worktreePath && !worktreePath) worktreePath = f.worktreePath
    console.log(`[smoke] feature:updated status=${f.status}${f.error ? ` error=${f.error}` : ''}`)
    if (f.status === 'complete') {
      featureComplete = true
      resolve()
    } else if (f.status === 'failed') {
      featureError = f.error ?? 'unknown'
      reject(new Error(`feature failed: ${featureError}`))
    }
  })

  socket.on('node:complete', (ev: { title: string; summary: string }) => {
    console.log(`[smoke] node:complete ${ev.title} -> ${ev.summary.slice(0, 120).replace(/\n/g, ' ')}…`)
  })
})

const timeout = setTimeout(
  () => fail(`timeout ${TIMEOUT_MS}ms (featureId=${featureId} complete=${featureComplete} err=${featureError})`),
  TIMEOUT_MS,
)
try {
  await done
} catch (e) {
  clearTimeout(timeout)
  socket.close()
  await cleanup()
  fail(String(e))
}
clearTimeout(timeout)
socket.close()

// 4. Verify worktree + file.
if (!worktreePath) {
  await cleanup()
  fail('no worktree path observed')
}
if (!existsSync(worktreePath)) {
  await cleanup()
  fail(`worktree dir missing: ${worktreePath}`)
}
const sentinelPath = path.join(worktreePath, SENTINEL_FILE)
if (!existsSync(sentinelPath)) {
  await cleanup()
  fail(`sentinel file not created: ${sentinelPath}`)
}
const content = readFileSync(sentinelPath, 'utf8').trim()
if (!content.includes(SENTINEL_CONTENT)) {
  await cleanup()
  fail(`sentinel file content does not contain "${SENTINEL_CONTENT}": got "${content.slice(0, 200)}"`)
}
console.log(`[smoke] ✓ sentinel file at ${sentinelPath} contains "${SENTINEL_CONTENT}"`)

// Optional bonus: verify the feature branch has at least one commit beyond the initial.
try {
  const wtGit = simpleGit(worktreePath)
  const log = await wtGit.log({ maxCount: 5 })
  console.log(`[smoke] worktree has ${log.total} commits; latest: ${log.latest?.message}`)
} catch (e) {
  console.warn(`[smoke] could not read worktree log: ${e}`)
}

await cleanup()
console.log('[smoke] PASS — Phase 5 ship+feature+worktree+file-edit verified end-to-end')
process.exit(0)
