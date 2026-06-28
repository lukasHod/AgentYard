import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'

// ── Runs ─────────────────────────────────────────────────────────────────────

export interface AuditRunInit {
  id: string
  featureId: number
  workflowId: number
  workflowName: string
  workflowSnapshotJson: string
  workflowSnapshotHash: string
  task: string
  branch?: string | null
  worktreePath?: string | null
  cwd?: string | null
}

export function initAuditRun(opts: AuditRunInit): void {
  const now = Date.now()
  const db = getDb()
  const existing = db.prepare('SELECT id FROM runs WHERE id = ?').get(opts.id)
  if (existing) {
    db.prepare(`
      UPDATE runs SET
        workflow_name = ?,
        workflow_snapshot_json = ?,
        workflow_snapshot_hash = ?,
        branch = ?,
        worktree_path = ?,
        started_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      opts.workflowName,
      opts.workflowSnapshotJson,
      opts.workflowSnapshotHash,
      opts.branch ?? null,
      opts.worktreePath ?? null,
      now,
      now,
      opts.id,
    )
  } else {
    db.prepare(`
      INSERT INTO runs
        (id, feature_id, workflow_id, task, agent_kind, state,
         workflow_name, workflow_snapshot_json, workflow_snapshot_hash,
         branch, worktree_path, cwd, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'claude-sdk', 'not_started',
              ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      opts.id,
      opts.featureId,
      opts.workflowId,
      opts.task,
      opts.workflowName,
      opts.workflowSnapshotJson,
      opts.workflowSnapshotHash,
      opts.branch ?? null,
      opts.worktreePath ?? null,
      opts.cwd ?? null,
      now,
      now,
      now,
    )
  }
}

export function updateAuditRun(
  runId: string,
  patch: Partial<{
    state: string
    finalSummary: string | null
    error: string | null
    completedAt: number | null
    resolvedCapabilitySnapshotJson: string | null
  }>,
): void {
  const sets: string[] = ['updated_at = ?']
  const vals: unknown[] = [Date.now()]
  if ('state' in patch) { sets.push('state = ?'); vals.push(patch.state) }
  if ('finalSummary' in patch) { sets.push('final_summary = ?'); vals.push(patch.finalSummary) }
  if ('error' in patch) { sets.push('error = ?'); vals.push(patch.error) }
  if ('completedAt' in patch) { sets.push('completed_at = ?'); vals.push(patch.completedAt) }
  if ('resolvedCapabilitySnapshotJson' in patch) {
    sets.push('resolved_capability_snapshot_json = ?')
    vals.push(patch.resolvedCapabilitySnapshotJson)
  }
  if (sets.length === 1) return
  vals.push(runId)
  getDb().prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

// ── Node runs ─────────────────────────────────────────────────────────────────

export interface AuditNodeRunInit {
  runId: string
  nodeId: string
  title: string
  nodeType?: string
  customType?: string
}

export function initAuditNodeRun(opts: AuditNodeRunInit): string {
  const id = randomUUID()
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO node_runs
      (id, run_id, node_id, title, state, node_type, custom_type, started_at)
    VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
  `).run(id, opts.runId, opts.nodeId, opts.title, opts.nodeType ?? null, opts.customType ?? null, now)
  return id
}

export function updateAuditNodeRun(
  nodeRunId: string,
  patch: Partial<{ state: string; summary: string | null; error: string | null; endedAt: number }>,
): void {
  const sets: string[] = []
  const vals: unknown[] = []
  if ('state' in patch) { sets.push('state = ?'); vals.push(patch.state) }
  if ('summary' in patch) { sets.push('summary = ?'); vals.push(patch.summary) }
  if ('error' in patch) {
    // store errors in summary field since node_runs has no error column
    if (patch.error && !('summary' in patch)) { sets.push('summary = ?'); vals.push(patch.error) }
  }
  if ('endedAt' in patch) { sets.push('ended_at = ?'); vals.push(patch.endedAt) }
  if (sets.length === 0) return
  vals.push(nodeRunId)
  getDb().prepare(`UPDATE node_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

// ── Node attempts ─────────────────────────────────────────────────────────────

export function createNodeAttempt(runId: string, nodeRunId: string, attemptNumber: number): number {
  const now = Date.now()
  const info = getDb().prepare(`
    INSERT INTO workflow_node_attempts
      (run_id, node_run_id, attempt_number, status, started_at, created_at, updated_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `).run(runId, nodeRunId, attemptNumber, now, now, now)
  return Number(info.lastInsertRowid)
}

export function updateNodeAttempt(
  attemptId: number,
  patch: Partial<{ status: string; summary: string | null; error: string | null; completedAt: number }>,
): void {
  const sets: string[] = ['updated_at = ?']
  const vals: unknown[] = [Date.now()]
  if ('status' in patch) { sets.push('status = ?'); vals.push(patch.status) }
  if ('summary' in patch) { sets.push('summary = ?'); vals.push(patch.summary) }
  if ('error' in patch) { sets.push('error = ?'); vals.push(patch.error) }
  if ('completedAt' in patch) { sets.push('completed_at = ?'); vals.push(patch.completedAt) }
  vals.push(attemptId)
  getDb().prepare(`UPDATE workflow_node_attempts SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function getLatestAttemptId(nodeRunId: string): number | null {
  const row = getDb()
    .prepare('SELECT id FROM workflow_node_attempts WHERE node_run_id = ? ORDER BY attempt_number DESC LIMIT 1')
    .get(nodeRunId) as { id: number } | undefined
  return row?.id ?? null
}

// ── Session capabilities ───────────────────────────────────────────────────

export interface SessionCapabilities {
  agentName?: string
  model?: string
  skillNames?: string[]
  scriptNames?: string[]
  mcpNames?: string[]
  toolPreset?: string
  allowedTools?: string[]
  effectiveTools?: string[]
  permissionMode?: string
  enforcementStatus?: string
  enforcementReason?: string
  nodeRunId?: string
}

export function upsertSessionCapabilities(sessionId: string, caps: SessionCapabilities): void {
  const sets: string[] = ['updated_at = ?']
  const vals: unknown[] = [Date.now()]
  if (caps.agentName !== undefined) { sets.push('agent_name = ?'); vals.push(caps.agentName) }
  if (caps.model !== undefined) { sets.push('model = ?'); vals.push(caps.model) }
  if (caps.skillNames !== undefined) { sets.push('skills_json = ?'); vals.push(JSON.stringify(caps.skillNames)) }
  if (caps.scriptNames !== undefined) { sets.push('scripts_json = ?'); vals.push(JSON.stringify(caps.scriptNames)) }
  if (caps.mcpNames !== undefined) { sets.push('mcps_json = ?'); vals.push(JSON.stringify(caps.mcpNames)) }
  if (caps.toolPreset !== undefined) { sets.push('tool_preset = ?'); vals.push(caps.toolPreset) }
  if (caps.allowedTools !== undefined) { sets.push('allowed_tools_json = ?'); vals.push(JSON.stringify(caps.allowedTools)) }
  if (caps.effectiveTools !== undefined) { sets.push('effective_tools_json = ?'); vals.push(JSON.stringify(caps.effectiveTools)) }
  if (caps.permissionMode !== undefined) { sets.push('permission_mode = ?'); vals.push(caps.permissionMode) }
  if (caps.enforcementStatus !== undefined) { sets.push('enforcement_status = ?'); vals.push(caps.enforcementStatus) }
  if (caps.enforcementReason !== undefined) { sets.push('enforcement_reason = ?'); vals.push(caps.enforcementReason) }
  if (caps.nodeRunId !== undefined) { sets.push('node_run_id = ?'); vals.push(caps.nodeRunId) }
  if (sets.length === 1) return
  vals.push(sessionId)
  getDb().prepare(`UPDATE runner_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

// ── Audit events ──────────────────────────────────────────────────────────────

export type AuditEventSeverity = 'info' | 'success' | 'warning' | 'error'

export interface AuditEventOpts {
  runId: string
  eventType: string
  title: string
  summary?: string
  details?: Record<string, unknown>
  severity?: AuditEventSeverity
  nodeRunId?: string | null
  nodeAttemptId?: number | null
  sessionId?: string | null
}

export function insertAuditEvent(opts: AuditEventOpts): number {
  const now = Date.now()
  const info = getDb().prepare(`
    INSERT INTO workflow_audit_events
      (run_id, node_run_id, node_attempt_id, session_id,
       event_type, title, summary, details_json, severity, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.runId,
    opts.nodeRunId ?? null,
    opts.nodeAttemptId ?? null,
    opts.sessionId ?? null,
    opts.eventType,
    opts.title,
    opts.summary ?? null,
    opts.details ? JSON.stringify(opts.details) : null,
    opts.severity ?? 'info',
    now,
  )
  return Number(info.lastInsertRowid)
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export interface RunListItem {
  id: string
  featureId: number
  workflowName: string | null
  workflowSnapshotHash: string | null
  state: string
  startedAt: number | null
  completedAt: number | null
  finalSummary: string | null
  error: string | null
  nodeCount: number
  attemptCount: number
  createdAt: number
}

export function listAuditRunsForFeature(featureId: number): RunListItem[] {
  const rows = getDb().prepare(`
    SELECT
      r.id, r.feature_id, r.workflow_name, r.workflow_snapshot_hash,
      r.state, r.started_at, r.completed_at, r.final_summary, r.error, r.created_at,
      COUNT(DISTINCT nr.id) AS node_count,
      COUNT(DISTINCT wa.id) AS attempt_count
    FROM runs r
    LEFT JOIN node_runs nr ON nr.run_id = r.id
    LEFT JOIN workflow_node_attempts wa ON wa.run_id = r.id
    WHERE r.feature_id = ?
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all(featureId) as any[]

  return rows.map((r) => ({
    id: r.id,
    featureId: r.feature_id,
    workflowName: r.workflow_name,
    workflowSnapshotHash: r.workflow_snapshot_hash,
    state: r.state,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    finalSummary: r.final_summary,
    error: r.error,
    nodeCount: r.node_count,
    attemptCount: r.attempt_count,
    createdAt: r.created_at,
  }))
}

export interface RunDetail {
  run: {
    id: string
    featureId: number
    workflowId: number
    workflowName: string | null
    workflowSnapshotHash: string | null
    workflowSnapshotJson: string | null
    task: string
    state: string
    branch: string | null
    worktreePath: string | null
    startedAt: number | null
    completedAt: number | null
    finalSummary: string | null
    error: string | null
    createdAt: number
  }
  nodeRuns: Array<{
    id: string
    nodeId: string
    title: string
    state: string
    nodeType: string | null
    summary: string | null
    startedAt: number | null
    endedAt: number | null
    attemptCount: number
  }>
  attempts: Array<{
    id: number
    nodeRunId: string
    attemptNumber: number
    status: string
    startedAt: number
    completedAt: number | null
    summary: string | null
    error: string | null
  }>
  sessions: Array<{
    id: string
    nodeRunId: string | null
    agentName: string | null
    role: string
    runtimeKind: string
    model: string | null
    enforcementStatus: string
    enforcementReason: string | null
    skillNames: string[]
    mcpNames: string[]
    effectiveTools: string[]
    state: string
  }>
}

export function getAuditRunDetail(runId: string): RunDetail | null {
  const db = getDb()

  const runRow = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as any
  if (!runRow) return null

  const nodeRunRows = db.prepare(`
    SELECT nr.*, COUNT(wa.id) AS attempt_count
    FROM node_runs nr
    LEFT JOIN workflow_node_attempts wa ON wa.node_run_id = nr.id
    WHERE nr.run_id = ?
    GROUP BY nr.id
    ORDER BY nr.started_at ASC NULLS LAST, nr.id ASC
  `).all(runId) as any[]

  const attemptRows = db.prepare(`
    SELECT * FROM workflow_node_attempts WHERE run_id = ? ORDER BY node_run_id, attempt_number
  `).all(runId) as any[]

  const sessionRows = db.prepare(`
    SELECT * FROM runner_sessions WHERE run_id = ? ORDER BY created_at ASC
  `).all(runId) as any[]

  return {
    run: {
      id: runRow.id,
      featureId: runRow.feature_id,
      workflowId: runRow.workflow_id,
      workflowName: runRow.workflow_name,
      workflowSnapshotHash: runRow.workflow_snapshot_hash,
      workflowSnapshotJson: runRow.workflow_snapshot_json,
      task: runRow.task,
      state: runRow.state,
      branch: runRow.branch,
      worktreePath: runRow.worktree_path,
      startedAt: runRow.started_at,
      completedAt: runRow.completed_at,
      finalSummary: runRow.final_summary,
      error: runRow.error,
      createdAt: runRow.created_at,
    },
    nodeRuns: nodeRunRows.map((r) => ({
      id: r.id,
      nodeId: r.node_id,
      title: r.title,
      state: r.state,
      nodeType: r.node_type,
      summary: r.summary,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      attemptCount: r.attempt_count,
    })),
    attempts: attemptRows.map((r) => ({
      id: r.id,
      nodeRunId: r.node_run_id,
      attemptNumber: r.attempt_number,
      status: r.status,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      summary: r.summary,
      error: r.error,
    })),
    sessions: sessionRows.map((r) => ({
      id: r.id,
      nodeRunId: r.node_run_id,
      agentName: r.agent_name,
      role: r.role,
      runtimeKind: r.runtime_kind,
      model: r.model,
      enforcementStatus: r.enforcement_status,
      enforcementReason: r.enforcement_reason,
      skillNames: r.skills_json ? JSON.parse(r.skills_json) : [],
      mcpNames: r.mcps_json ? JSON.parse(r.mcps_json) : [],
      effectiveTools: r.effective_tools_json ? JSON.parse(r.effective_tools_json) : [],
      state: r.state,
    })),
  }
}

export interface AuditEventRow {
  id: number
  runId: string
  nodeRunId: string | null
  nodeAttemptId: number | null
  sessionId: string | null
  eventType: string
  title: string
  summary: string | null
  detailsJson: string | null
  severity: string
  createdAt: number
}

export function listAuditEvents(
  runId: string,
  opts: {
    cursor?: number
    limit?: number
    nodeRunId?: string
    sessionId?: string
    eventType?: string
    severity?: string
  } = {},
): { events: AuditEventRow[]; nextCursor: number | null } {
  const limit = Math.min(opts.limit ?? 50, 200)
  const conditions: string[] = ['run_id = ?']
  const params: unknown[] = [runId]

  if (opts.cursor) { conditions.push('id > ?'); params.push(opts.cursor) }
  if (opts.nodeRunId) { conditions.push('node_run_id = ?'); params.push(opts.nodeRunId) }
  if (opts.sessionId) { conditions.push('session_id = ?'); params.push(opts.sessionId) }
  if (opts.eventType) { conditions.push('event_type = ?'); params.push(opts.eventType) }
  if (opts.severity) { conditions.push('severity = ?'); params.push(opts.severity) }

  params.push(limit + 1)
  const rows = getDb().prepare(`
    SELECT * FROM workflow_audit_events
    WHERE ${conditions.join(' AND ')}
    ORDER BY id ASC
    LIMIT ?
  `).all(...params) as any[]

  const hasMore = rows.length > limit
  const slice = hasMore ? rows.slice(0, limit) : rows
  return {
    events: slice.map((r) => ({
      id: r.id,
      runId: r.run_id,
      nodeRunId: r.node_run_id,
      nodeAttemptId: r.node_attempt_id,
      sessionId: r.session_id,
      eventType: r.event_type,
      title: r.title,
      summary: r.summary,
      detailsJson: r.details_json,
      severity: r.severity,
      createdAt: r.created_at,
    })),
    nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
  }
}
