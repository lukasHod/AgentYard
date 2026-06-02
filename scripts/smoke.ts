/**
 * Phase 5 smoke test — full feature flow with real AI agents.
 *
 * Runs against the existing "smoke-planet" planet (must point at a real git
 * repo, e.g. the AgentYard repo itself). The smoke does NOT create or delete
 * the planet; pre-flight just verifies one exists.
 *
 *  1. Look up smoke-planet.
 *  2. POST /api/planets/:id/features with a concrete file-writing task.
 *  3. Wait for the feature to reach status=complete (via socket events).
 *  4. Verify the worktree exists and contains the expected file.
 *  5. Tear down: remove worktree via /teardown, delete throwaway branch.
 *
 * This test makes real Claude API calls (3 workflow nodes) — expect it to
 * take a few minutes and burn tokens.
 *
 * Run with: npx tsx scripts/smoke.ts
 * (Assumes `npm run dev` is already running and a "smoke-planet" exists.)
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { io } from 'socket.io-client'

const BASE = 'http://localhost:4242'
const PLANET_NAME = 'smoke-planet'
const TIMEOUT_MS = 600_000 // 10 min — three nodes with real file work.
const SENTINEL_FILE = 'hello-agentyard.txt'
const SENTINEL_CONTENT = 'hello, agentyard'
const TASK = `Create a file named ${SENTINEL_FILE} at the repo root containing exactly the text "${SENTINEL_CONTENT}" (no surrounding quotes, no trailing newline required). The deploy phase must commit this change.`

interface Planet {
  id: number
  name: string
  projectPath: string
  pathExists: boolean
}

function fail(msg: string): never {
  console.error(`[smoke] FAIL: ${msg}`)
  process.exit(1)
}

// 1. Find the existing smoke-planet.
const planets = (await fetch(`${BASE}/api/planets`).then((r) => r.json())) as Planet[]
const planet = planets.find((s) => s.name === PLANET_NAME)
if (!planet) {
  fail(`no planet named "${PLANET_NAME}" registered. Create one pointing at a git repo via the galaxy view first.`)
}
if (!planet!.pathExists) {
  fail(`planet "${PLANET_NAME}" projectPath does not exist on disk: ${planet!.projectPath}`)
}
const planetId = planet!.id
const planetPath = planet!.projectPath
console.log(`[smoke] using smoke-planet #${planetId} at ${planetPath}`)

let featureId: number | null = null
let featureBranch: string | null = null

async function cleanup() {
  // Tear down agent sessions first so they release worktree file handles.
  try {
    await fetch(`${BASE}/api/runs/reset`, { method: 'POST' })
  } catch {
    /* ignore */
  }
  if (featureId !== null) {
    try {
      await fetch(`${BASE}/api/features/${featureId}/teardown`, { method: 'POST' })
    } catch {
      /* ignore */
    }
  }
  // Wait a beat for file handles to close, then delete the throwaway branch.
  await new Promise((r) => setTimeout(r, 1500))
  if (featureBranch) {
    try {
      await simpleGit(planetPath).raw(['branch', '-D', featureBranch])
      console.log(`[smoke] deleted branch ${featureBranch}`)
    } catch (e) {
      console.warn(`[smoke] could not delete branch ${featureBranch}: ${e}`)
    }
  }
}

// 2. Subscribe to events, then create feature.
const socket = io(BASE, { transports: ['websocket'] })
let featureComplete = false
let featureError: string | null = null
let worktreePath: string | null = null

const done = new Promise<void>((resolve, reject) => {
  socket.on('connect', async () => {
    const res = await fetch(`${BASE}/api/planets/${planetId}/features`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'add-greeting', task: TASK }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      reject(new Error(`POST /api/planets/${planetId}/features -> ${res.status}: ${JSON.stringify(j)}`))
      return
    }
    const body = await res.json()
    featureId = body.feature.id
    worktreePath = body.feature.worktreePath
    featureBranch = body.feature.branch ?? null
    console.log(`[smoke] feature #${featureId} created; worktree=${worktreePath ?? '(pending)'} branch=${featureBranch ?? '(pending)'}`)
  })

  socket.on('feature:updated', (f: { id: number; status: string; worktreePath?: string; branch?: string; error?: string; finalSummary?: string }) => {
    if (f.id !== featureId) return
    if (f.worktreePath && !worktreePath) worktreePath = f.worktreePath
    if (f.branch && !featureBranch) featureBranch = f.branch
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

// 3. Verify worktree + file.
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
console.log('[smoke] PASS — Phase 5 planet+feature+worktree+file-edit verified end-to-end')
process.exit(0)
