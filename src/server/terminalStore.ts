import type {
  TerminalProfileId,
  TerminalSessionDescriptor,
  TerminalSessionState,
} from '../core/types.js'
import { getDb } from './db.js'

interface TerminalSessionRow {
  id: string
  profile_id: string
  runtime_kind: string
  planet_id: number | null
  feature_id: number | null
  workflow_run_id: string | null
  node_run_id: string | null
  agent_session_id: string | null
  role: string | null
  cwd: string | null
  argv_json: string
  env_json: string | null
  state: string
  exit_code: number | null
  exit_signal: number | null
  pid: number | null
  created_at: number
  updated_at: number
  last_started_at: number | null
  last_exited_at: number | null
}

function rowToDescriptor(row: TerminalSessionRow): TerminalSessionDescriptor {
  return {
    id: row.id,
    profileId: row.profile_id as TerminalProfileId,
    runtimeKind: 'pty',
    planetId: row.planet_id,
    featureId: row.feature_id,
    workflowRunId: row.workflow_run_id,
    nodeRunId: row.node_run_id,
    agentSessionId: row.agent_session_id,
    role: row.role,
    cwd: row.cwd,
    argv: JSON.parse(row.argv_json) as string[],
    state: row.state as TerminalSessionState,
    exitCode: row.exit_code,
    exitSignal: row.exit_signal,
    pid: row.pid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastStartedAt: row.last_started_at,
    lastExitedAt: row.last_exited_at,
  }
}

export function createTerminalSession(record: {
  id: string
  profileId: TerminalProfileId
  planetId?: number | null
  featureId?: number | null
  workflowRunId?: string | null
  nodeRunId?: string | null
  agentSessionId?: string | null
  role?: string | null
  cwd?: string | null
  argv: string[]
  env?: Record<string, string> | null
  pid?: number | null
}): TerminalSessionDescriptor {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO terminal_sessions
       (id, profile_id, runtime_kind, planet_id, feature_id, workflow_run_id, node_run_id,
        agent_session_id, role, cwd, argv_json, env_json, state, pid, created_at, updated_at,
        last_started_at)
       VALUES (?, ?, 'pty', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.profileId,
      record.planetId ?? null,
      record.featureId ?? null,
      record.workflowRunId ?? null,
      record.nodeRunId ?? null,
      record.agentSessionId ?? null,
      record.role ?? null,
      record.cwd ?? null,
      JSON.stringify(record.argv),
      record.env ? JSON.stringify(record.env) : null,
      record.pid ?? null,
      now,
      now,
      now,
    )
  return getTerminalSession(record.id)!
}

export function getTerminalSession(id: string): TerminalSessionDescriptor | undefined {
  const row = getDb()
    .prepare('SELECT * FROM terminal_sessions WHERE id = ?')
    .get(id) as TerminalSessionRow | undefined
  return row ? rowToDescriptor(row) : undefined
}

export function getTerminalSessionEnv(id: string): Record<string, string> | undefined {
  const row = getDb()
    .prepare('SELECT env_json FROM terminal_sessions WHERE id = ?')
    .get(id) as Pick<TerminalSessionRow, 'env_json'> | undefined
  return row?.env_json ? (JSON.parse(row.env_json) as Record<string, string>) : undefined
}

export function listTerminalSessions(): TerminalSessionDescriptor[] {
  const rows = getDb()
    .prepare('SELECT * FROM terminal_sessions ORDER BY created_at DESC')
    .all() as TerminalSessionRow[]
  return rows.map(rowToDescriptor)
}

export function updateTerminalSession(
  id: string,
  patch: Partial<{
    state: TerminalSessionState
    exitCode: number | null
    exitSignal: number | null
    pid: number | null
    lastStartedAt: number | null
    lastExitedAt: number | null
  }>,
): TerminalSessionDescriptor | undefined {
  const sets: string[] = ['updated_at = ?']
  const vals: unknown[] = [Date.now()]
  if ('state' in patch) {
    sets.push('state = ?')
    vals.push(patch.state)
  }
  if ('exitCode' in patch) {
    sets.push('exit_code = ?')
    vals.push(patch.exitCode)
  }
  if ('exitSignal' in patch) {
    sets.push('exit_signal = ?')
    vals.push(patch.exitSignal)
  }
  if ('pid' in patch) {
    sets.push('pid = ?')
    vals.push(patch.pid)
  }
  if ('lastStartedAt' in patch) {
    sets.push('last_started_at = ?')
    vals.push(patch.lastStartedAt)
  }
  if ('lastExitedAt' in patch) {
    sets.push('last_exited_at = ?')
    vals.push(patch.lastExitedAt)
  }
  if (sets.length === 1) return getTerminalSession(id)
  vals.push(id)
  getDb()
    .prepare(`UPDATE terminal_sessions SET ${sets.join(', ')} WHERE id = ?`)
    .run(...vals)
  return getTerminalSession(id)
}

export function appendTerminalChunk(sessionId: string, data: string, ts = Date.now()): number {
  const info = getDb()
    .prepare('INSERT INTO terminal_transcript_chunks (session_id, ts, data) VALUES (?, ?, ?)')
    .run(sessionId, ts, data)
  return Number(info.lastInsertRowid)
}

export function listTerminalChunks(sessionId: string, opts?: { limit?: number }): string[] {
  if (opts?.limit) {
    const rows = getDb()
      .prepare(
        `SELECT data FROM terminal_transcript_chunks
         WHERE session_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(sessionId, opts.limit) as { data: string }[]
    return rows.reverse().map((row) => row.data)
  }
  const rows = getDb()
    .prepare(
      `SELECT data FROM terminal_transcript_chunks
       WHERE session_id = ?
       ORDER BY id`,
    )
    .all(sessionId) as { data: string }[]
  return rows.map((row) => row.data)
}

/**
 * Drop a terminal session row and its transcript chunks. Chunks cascade via
 * the FK ON DELETE CASCADE, so a single DELETE on the parent is enough.
 * Returns true if a row was removed; false if no such id existed.
 */
export function deleteTerminalSession(id: string): boolean {
  const info = getDb().prepare('DELETE FROM terminal_sessions WHERE id = ?').run(id)
  return info.changes > 0
}

export function markRunningTerminalsRuntimeLost(): number {
  const now = Date.now()
  const info = getDb()
    .prepare(
      `UPDATE terminal_sessions
       SET state = 'runtime_lost', pid = NULL, updated_at = ?, last_exited_at = ?
       WHERE state = 'running'`,
    )
    .run(now, now)
  return info.changes
}
