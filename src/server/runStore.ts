import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  AgentKind,
  AgentLifecycleState,
  AgentTerminalReason,
  RuntimeKind,
} from '../core/plugins.js'
import type { AgentRole, NodeRunStatus } from '../core/types.js'
import { getDb } from './db.js'
import { createRepo } from './repository.js'

/**
 * Typed CRUD over the Phase 4 runner-persistence tables (`runs`,
 * `node_runs`, `runner_sessions`, `runner_events`). The `runner_events`
 * table is the source of truth; snapshot tables are kept up to date in the
 * same transaction so the UI can read them directly without replaying.
 *
 * Boundary rules:
 * - All AgentEvents flow through `appendRunnerEvent` (transactional with the
 *   snapshot patch the caller wants to apply alongside).
 * - State transitions on `runs` / `node_runs` / `runner_sessions` should
 *   always go via the typed `update*` helpers — direct SQL bypasses the
 *   `updated_at` bookkeeping.
 */

// ── runs ─────────────────────────────────────────────────────────────────
export interface Run {
  id: string
  featureId: number
  workflowId: number
  task: string
  agentKind: AgentKind
  state: AgentLifecycleState
  reason: AgentTerminalReason | null
  finalSummary: string | null
  error: string | null
  cwd: string | null
  createdAt: number
  updatedAt: number
}

interface RunRow {
  id: string
  feature_id: number
  workflow_id: number
  task: string
  agent_kind: string
  state: string
  reason: string | null
  final_summary: string | null
  error: string | null
  cwd: string | null
  created_at: number
  updated_at: number
}

function rowToRun(r: RunRow): Run {
  return {
    id: r.id,
    featureId: r.feature_id,
    workflowId: r.workflow_id,
    task: r.task,
    agentKind: r.agent_kind as AgentKind,
    state: r.state as AgentLifecycleState,
    reason: r.reason as AgentTerminalReason | null,
    finalSummary: r.final_summary,
    error: r.error,
    cwd: r.cwd,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const runs = createRepo<RunRow, Run>(rowToRun)

export function createRun(opts: {
  featureId: number
  workflowId: number
  task: string
  agentKind: AgentKind
  cwd?: string
  id?: string
}): Run {
  const id = opts.id ?? randomUUID()
  const now = Date.now()
  runs
    .db()
    .prepare(
      `INSERT INTO runs (id, feature_id, workflow_id, task, agent_kind, state, cwd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'not_started', ?, ?, ?)`,
    )
    .run(id, opts.featureId, opts.workflowId, opts.task, opts.agentKind, opts.cwd ?? null, now, now)
  return getRun(id)!
}

export function getRun(id: string): Run | undefined {
  return runs.one('SELECT * FROM runs WHERE id = ?', id)
}

export function listRunsForFeature(featureId: number): Run[] {
  return runs.all('SELECT * FROM runs WHERE feature_id = ? ORDER BY created_at DESC', featureId)
}

/** Most recent non-terminal run for a feature, if any. */
export function getActiveRunForFeature(featureId: number): Run | undefined {
  return runs.one(
    `SELECT * FROM runs
     WHERE feature_id = ? AND state NOT IN ('done', 'terminated')
     ORDER BY created_at DESC
     LIMIT 1`,
    featureId,
  )
}

export function updateRun(
  id: string,
  patch: Partial<{
    state: AgentLifecycleState
    reason: AgentTerminalReason | null
    finalSummary: string | null
    error: string | null
    cwd: string | null
  }>,
): Run | undefined {
  const sets: string[] = ['updated_at = ?']
  const vals: unknown[] = [Date.now()]
  if ('state' in patch) {
    sets.push('state = ?')
    vals.push(patch.state)
  }
  if ('reason' in patch) {
    sets.push('reason = ?')
    vals.push(patch.reason)
  }
  if ('finalSummary' in patch) {
    sets.push('final_summary = ?')
    vals.push(patch.finalSummary)
  }
  if ('error' in patch) {
    sets.push('error = ?')
    vals.push(patch.error)
  }
  if ('cwd' in patch) {
    sets.push('cwd = ?')
    vals.push(patch.cwd)
  }
  if (sets.length === 1) return getRun(id)
  vals.push(id)
  runs.db().prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  return getRun(id)
}

// ── node_runs ────────────────────────────────────────────────────────────
export interface NodeRun {
  id: string
  runId: string
  nodeId: string
  title: string
  state: NodeRunStatus | 'skipped'
  summary: string | null
  outputs: Record<string, string> | null
  startedAt: number | null
  endedAt: number | null
}

interface NodeRunRow {
  id: string
  run_id: string
  node_id: string
  title: string
  state: string
  summary: string | null
  outputs_json: string | null
  started_at: number | null
  ended_at: number | null
}

function rowToNodeRun(r: NodeRunRow): NodeRun {
  return {
    id: r.id,
    runId: r.run_id,
    nodeId: r.node_id,
    title: r.title,
    state: r.state as NodeRun['state'],
    summary: r.summary,
    outputs: r.outputs_json ? (JSON.parse(r.outputs_json) as Record<string, string>) : null,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  }
}

const nodeRuns = createRepo<NodeRunRow, NodeRun>(rowToNodeRun)

export function createNodeRun(opts: {
  runId: string
  nodeId: string
  title: string
  id?: string
}): NodeRun {
  const id = opts.id ?? randomUUID()
  nodeRuns
    .db()
    .prepare(
      `INSERT INTO node_runs (id, run_id, node_id, title, state) VALUES (?, ?, ?, ?, 'pending')`,
    )
    .run(id, opts.runId, opts.nodeId, opts.title)
  return getNodeRun(id)!
}

export function getNodeRun(id: string): NodeRun | undefined {
  return nodeRuns.one('SELECT * FROM node_runs WHERE id = ?', id)
}

export function listNodeRunsForRun(runId: string): NodeRun[] {
  return nodeRuns.all('SELECT * FROM node_runs WHERE run_id = ? ORDER BY id', runId)
}

export function updateNodeRun(
  id: string,
  patch: Partial<{
    state: NodeRun['state']
    summary: string | null
    outputs: Record<string, string> | null
    startedAt: number | null
    endedAt: number | null
  }>,
): NodeRun | undefined {
  const sets: string[] = []
  const vals: unknown[] = []
  if ('state' in patch) {
    sets.push('state = ?')
    vals.push(patch.state)
  }
  if ('summary' in patch) {
    sets.push('summary = ?')
    vals.push(patch.summary)
  }
  if ('outputs' in patch) {
    sets.push('outputs_json = ?')
    vals.push(patch.outputs ? JSON.stringify(patch.outputs) : null)
  }
  if ('startedAt' in patch) {
    sets.push('started_at = ?')
    vals.push(patch.startedAt)
  }
  if ('endedAt' in patch) {
    sets.push('ended_at = ?')
    vals.push(patch.endedAt)
  }
  if (sets.length === 0) return getNodeRun(id)
  vals.push(id)
  nodeRuns.db().prepare(`UPDATE node_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  return getNodeRun(id)
}

// ── runner_sessions ──────────────────────────────────────────────────────
export interface RunnerSession {
  id: string
  runId: string | null
  nodeRunId: string | null
  featureId: number | null
  planetId: number | null
  agentKind: AgentKind
  runtimeKind: RuntimeKind
  role: AgentRole
  label: string | null
  state: AgentLifecycleState
  reason: AgentTerminalReason | null
  pid: number | null
  pipePath: string | null
  cwd: string | null
  createdAt: number
  updatedAt: number
}

interface RunnerSessionRow {
  id: string
  run_id: string | null
  node_run_id: string | null
  feature_id: number | null
  planet_id: number | null
  agent_kind: string
  runtime_kind: string
  role: string
  label: string | null
  state: string
  reason: string | null
  pid: number | null
  pipe_path: string | null
  cwd: string | null
  created_at: number
  updated_at: number
}

function rowToRunnerSession(r: RunnerSessionRow): RunnerSession {
  return {
    id: r.id,
    runId: r.run_id,
    nodeRunId: r.node_run_id,
    featureId: r.feature_id,
    planetId: r.planet_id,
    agentKind: r.agent_kind as AgentKind,
    runtimeKind: r.runtime_kind as RuntimeKind,
    role: r.role as AgentRole,
    label: r.label,
    state: r.state as AgentLifecycleState,
    reason: r.reason as AgentTerminalReason | null,
    pid: r.pid,
    pipePath: r.pipe_path,
    cwd: r.cwd,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const runnerSessions = createRepo<RunnerSessionRow, RunnerSession>(rowToRunnerSession)

export interface CreateRunnerSessionOpts {
  id: string
  agentKind: AgentKind
  runtimeKind: RuntimeKind
  role: AgentRole
  runId?: string
  nodeRunId?: string
  featureId?: number
  planetId?: number
  label?: string
  pid?: number
  pipePath?: string
  cwd?: string
}

export function createRunnerSession(opts: CreateRunnerSessionOpts): RunnerSession {
  const now = Date.now()
  runnerSessions
    .db()
    .prepare(
      `INSERT INTO runner_sessions
       (id, run_id, node_run_id, feature_id, planet_id, agent_kind, runtime_kind, role,
        label, state, pid, pipe_path, cwd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.id,
      opts.runId ?? null,
      opts.nodeRunId ?? null,
      opts.featureId ?? null,
      opts.planetId ?? null,
      opts.agentKind,
      opts.runtimeKind,
      opts.role,
      opts.label ?? null,
      opts.pid ?? null,
      opts.pipePath ?? null,
      opts.cwd ?? null,
      now,
      now,
    )
  return getRunnerSession(opts.id)!
}

export function getRunnerSession(id: string): RunnerSession | undefined {
  return runnerSessions.one('SELECT * FROM runner_sessions WHERE id = ?', id)
}

export function listRunnerSessionsByState(states: AgentLifecycleState[]): RunnerSession[] {
  if (states.length === 0) return []
  const placeholders = states.map(() => '?').join(', ')
  return runnerSessions.all(
    `SELECT * FROM runner_sessions WHERE state IN (${placeholders}) ORDER BY id`,
    ...states,
  )
}

export function listNonTerminalRunnerSessions(): RunnerSession[] {
  return runnerSessions.all(
    `SELECT * FROM runner_sessions WHERE state NOT IN ('done', 'terminated')`,
  )
}

export function updateRunnerSession(
  id: string,
  patch: Partial<{
    state: AgentLifecycleState
    reason: AgentTerminalReason | null
    pid: number | null
    pipePath: string | null
    cwd: string | null
    label: string | null
  }>,
): RunnerSession | undefined {
  const sets: string[] = ['updated_at = ?']
  const vals: unknown[] = [Date.now()]
  if ('state' in patch) {
    sets.push('state = ?')
    vals.push(patch.state)
  }
  if ('reason' in patch) {
    sets.push('reason = ?')
    vals.push(patch.reason)
  }
  if ('pid' in patch) {
    sets.push('pid = ?')
    vals.push(patch.pid)
  }
  if ('pipePath' in patch) {
    sets.push('pipe_path = ?')
    vals.push(patch.pipePath)
  }
  if ('cwd' in patch) {
    sets.push('cwd = ?')
    vals.push(patch.cwd)
  }
  if ('label' in patch) {
    sets.push('label = ?')
    vals.push(patch.label)
  }
  if (sets.length === 1) return getRunnerSession(id)
  vals.push(id)
  runnerSessions
    .db()
    .prepare(`UPDATE runner_sessions SET ${sets.join(', ')} WHERE id = ?`)
    .run(...vals)
  return getRunnerSession(id)
}

export function deleteRunnerSession(id: string): void {
  runnerSessions.db().prepare('DELETE FROM runner_sessions WHERE id = ?').run(id)
}

// ── runner_events ────────────────────────────────────────────────────────
export interface RunnerEventRecord {
  id: number
  sessionId: string
  ts: number
  event: AgentEvent
}

interface RunnerEventRow {
  id: number
  session_id: string
  ts: number
  type: string
  payload_json: string
}

function rowToRunnerEvent(r: RunnerEventRow): RunnerEventRecord {
  // Trust the writer — events were schema-validated on insert (or assumed
  // shape-correct from the adapter). Re-validating with zod on every read
  // would cost a lot for chat catch-up; instead we cast and rely on the
  // type being part of the union via the discriminator at write time.
  return {
    id: r.id,
    sessionId: r.session_id,
    ts: r.ts,
    event: JSON.parse(r.payload_json) as AgentEvent,
  }
}

const runnerEvents = createRepo<RunnerEventRow, RunnerEventRecord>(rowToRunnerEvent)

/** Append a single event. Returns the row id. */
export function appendRunnerEvent(sessionId: string, event: AgentEvent): number {
  const info = runnerEvents
    .db()
    .prepare('INSERT INTO runner_events (session_id, ts, type, payload_json) VALUES (?, ?, ?, ?)')
    .run(sessionId, event.ts, event.type, JSON.stringify(event))
  return Number(info.lastInsertRowid)
}

export function listRunnerEvents(sessionId: string, opts?: { limit?: number }): RunnerEventRecord[] {
  if (opts?.limit) {
    return runnerEvents.all(
      'SELECT * FROM runner_events WHERE session_id = ? ORDER BY id DESC LIMIT ?',
      sessionId,
      opts.limit,
    ).reverse()
  }
  return runnerEvents.all(
    'SELECT * FROM runner_events WHERE session_id = ? ORDER BY id',
    sessionId,
  )
}

/**
 * Atomically: append an event AND apply a snapshot patch to runner_sessions
 * (the most common case — `state` events update the session row). Use the
 * raw helpers for cross-table snapshot updates (runs + node_runs together).
 */
export function appendEventAndUpdateSession(
  sessionId: string,
  event: AgentEvent,
  sessionPatch?: Parameters<typeof updateRunnerSession>[1],
): void {
  const db = getDb()
  const tx = db.transaction(() => {
    appendRunnerEvent(sessionId, event)
    if (sessionPatch) updateRunnerSession(sessionId, sessionPatch)
  })
  tx()
}
