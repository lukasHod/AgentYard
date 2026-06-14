import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { getDb } from './db.js'
import { getTerminalSessionEnv } from './terminalStore.js'
import { reviewGateRegistry } from './reviewGateRegistry.js'
import type { ReviewLoopRun, ReviewApproval } from '../core/types.js'

interface LoopRunRow {
  id: string
  node_run_id: string
  feature_id: number | null
  planet_id: number | null
  iteration: number
  max_iterations: number
  state: string
  developer_slots_json: string
  reviewer_slots_json: string
  approval_required_from_json: string
  developer_summary: string | null
  review_findings: string | null
  created_at: number
  updated_at: number
}

interface ApprovalRow {
  id: string
  loop_run_id: string
  iteration: number
  reviewer_slot: string
  terminal_session_id: string | null
  decision: string
  findings: string | null
  created_at: number
}

function rowToLoopRun(row: LoopRunRow, approvals: ApprovalRow[]): ReviewLoopRun {
  return {
    id: row.id,
    nodeRunId: row.node_run_id,
    featureId: row.feature_id,
    planetId: row.planet_id,
    iteration: row.iteration,
    maxIterations: row.max_iterations,
    state: row.state as ReviewLoopRun['state'],
    developerSlots: JSON.parse(row.developer_slots_json) as string[],
    reviewerSlots: JSON.parse(row.reviewer_slots_json) as string[],
    approvalRequiredFrom: JSON.parse(row.approval_required_from_json) as string[],
    developerSummary: row.developer_summary,
    reviewFindings: row.review_findings,
    approvals: approvals.map(rowToApproval),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToApproval(row: ApprovalRow): ReviewApproval {
  return {
    id: row.id,
    loopRunId: row.loop_run_id,
    iteration: row.iteration,
    reviewerSlot: row.reviewer_slot,
    terminalSessionId: row.terminal_session_id,
    decision: row.decision as ReviewApproval['decision'],
    findings: row.findings,
    createdAt: row.created_at,
  }
}

function getApprovals(loopRunId: string, iteration?: number): ApprovalRow[] {
  const db = getDb()
  if (iteration !== undefined) {
    return db
      .prepare(
        'SELECT * FROM review_approvals WHERE loop_run_id = ? AND iteration = ? ORDER BY created_at',
      )
      .all(loopRunId, iteration) as ApprovalRow[]
  }
  return db
    .prepare('SELECT * FROM review_approvals WHERE loop_run_id = ? ORDER BY iteration, created_at')
    .all(loopRunId) as ApprovalRow[]
}

/** Fires whenever a loop run is created or its state changes. */
export const reviewLoopEmitter = new EventEmitter()

export function createLoopRun(params: {
  nodeRunId: string
  featureId?: number | null
  planetId?: number | null
  maxIterations: number
  developerSlots: string[]
  reviewerSlots: string[]
  approvalRequiredFrom: string[]
}): ReviewLoopRun {
  const id = randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO review_loop_runs
       (id, node_run_id, feature_id, planet_id, iteration, max_iterations, state,
        developer_slots_json, reviewer_slots_json, approval_required_from_json,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, 'developers_running', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      params.nodeRunId,
      params.featureId ?? null,
      params.planetId ?? null,
      params.maxIterations,
      JSON.stringify(params.developerSlots),
      JSON.stringify(params.reviewerSlots),
      JSON.stringify(params.approvalRequiredFrom),
      now,
      now,
    )
  const run = getLoopRun(id)!
  reviewLoopEmitter.emit('update', run)
  return run
}

export function getLoopRun(id: string): ReviewLoopRun | undefined {
  const row = getDb()
    .prepare('SELECT * FROM review_loop_runs WHERE id = ?')
    .get(id) as LoopRunRow | undefined
  if (!row) return undefined
  return rowToLoopRun(row, getApprovals(id))
}

export function updateLoopRun(
  id: string,
  patch: Partial<{
    iteration: number
    state: ReviewLoopRun['state']
    developerSummary: string | null
    reviewFindings: string | null
  }>,
): ReviewLoopRun | undefined {
  const sets: string[] = ['updated_at = ?']
  const vals: unknown[] = [Date.now()]
  if ('iteration' in patch) { sets.push('iteration = ?'); vals.push(patch.iteration) }
  if ('state' in patch) { sets.push('state = ?'); vals.push(patch.state) }
  if ('developerSummary' in patch) { sets.push('developer_summary = ?'); vals.push(patch.developerSummary) }
  if ('reviewFindings' in patch) { sets.push('review_findings = ?'); vals.push(patch.reviewFindings) }
  vals.push(id)
  getDb().prepare(`UPDATE review_loop_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  const run = getLoopRun(id)
  if (run) reviewLoopEmitter.emit('update', run)
  return run
}

export function listActiveLoopRuns(): ReviewLoopRun[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM review_loop_runs
       WHERE state IN ('developers_running', 'reviewers_running')
       ORDER BY created_at DESC`,
    )
    .all() as LoopRunRow[]
  return rows.map((r) => rowToLoopRun(r, getApprovals(r.id)))
}

export function listLoopRunsByFeature(featureId: number): ReviewLoopRun[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM review_loop_runs WHERE feature_id = ? ORDER BY created_at DESC',
    )
    .all(featureId) as LoopRunRow[]
  return rows.map((r) => rowToLoopRun(r, getApprovals(r.id)))
}

export function createApproval(
  loopRunId: string,
  iteration: number,
  reviewerSlot: string,
  terminalSessionId: string | null,
): ReviewApproval {
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO review_approvals
       (id, loop_run_id, iteration, reviewer_slot, terminal_session_id, decision, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(id, loopRunId, iteration, reviewerSlot, terminalSessionId, Date.now())
  const row = getDb().prepare('SELECT * FROM review_approvals WHERE id = ?').get(id) as ApprovalRow
  return rowToApproval(row)
}

/**
 * Called by the `/api/bridge/submit-review` endpoint.
 *
 * Looks up the pending approval record by terminal session id, records the
 * decision, then checks whether all required reviewers for the current iteration
 * have now submitted. If so, it fires the review gate so `runReviewLoopNode`
 * can proceed to evaluate the loop decision.
 */
export function submitReview(
  terminalSessionId: string,
  decision: 'approved' | 'changes_requested',
  findings?: string,
):
  | { ok: true; loopRunId: string; allSubmitted: boolean; loopRun: ReviewLoopRun }
  | { ok: false; error: string } {
  const db = getDb()

  // Find the pending approval for this terminal
  const approval = db
    .prepare(
      `SELECT * FROM review_approvals
       WHERE terminal_session_id = ? AND decision = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(terminalSessionId) as ApprovalRow | undefined

  if (!approval) {
    // Fallback: look up loop run id from terminal env
    const env = getTerminalSessionEnv(terminalSessionId)
    const loopRunId = env?.AGENTYARD_LOOP_RUN_ID
    const reviewerSlot = env?.AGENTYARD_REVIEWER_SLOT
    if (!loopRunId || !reviewerSlot) {
      return { ok: false, error: 'no pending review approval found for this session' }
    }
    // The reviewer terminal might not have a pre-created approval record (e.g.
    // if it was spawned without one). Create one now.
    const loopRun = getLoopRun(loopRunId)
    if (!loopRun) return { ok: false, error: `review loop run ${loopRunId} not found` }
    createApproval(loopRunId, loopRun.iteration, reviewerSlot, terminalSessionId)
    return submitReview(terminalSessionId, decision, findings)
  }

  // Update the approval record
  db.prepare(
    `UPDATE review_approvals SET decision = ?, findings = ? WHERE id = ?`,
  ).run(decision, findings ?? null, approval.id)

  const loopRun = getLoopRun(approval.loop_run_id)
  if (!loopRun) return { ok: false, error: 'loop run not found' }

  // Check if all required approvers for this iteration have submitted
  const currentApprovals = getApprovals(approval.loop_run_id, loopRun.iteration)
  const requiredSlots = loopRun.approvalRequiredFrom
  const allSubmitted = requiredSlots.every((slot) =>
    currentApprovals.some((a) => a.reviewer_slot === slot && a.decision !== 'pending'),
  )

  if (allSubmitted) {
    const decisions = currentApprovals
      .filter((a) => requiredSlots.includes(a.reviewer_slot) && a.decision !== 'pending')
      .map((a) => ({
        reviewerSlot: a.reviewer_slot,
        decision: a.decision as 'approved' | 'changes_requested',
        findings: a.findings,
      }))
    reviewGateRegistry.submitDecision(approval.loop_run_id, approval.reviewer_slot, {
      reviewerSlot: approval.reviewer_slot,
      decision,
      findings: findings ?? null,
    })
    // The gate registry handles all slots internally, but we also push individual
    // decisions to make sure the gate resolves (in case some slots submitted before
    // the gate was registered).
    for (const d of decisions) {
      reviewGateRegistry.submitDecision(approval.loop_run_id, d.reviewerSlot, d)
    }
  } else {
    // Submit just this one decision so the gate can track partial progress
    reviewGateRegistry.submitDecision(approval.loop_run_id, approval.reviewer_slot, {
      reviewerSlot: approval.reviewer_slot,
      decision,
      findings: findings ?? null,
    })
  }

  const updatedRun = getLoopRun(approval.loop_run_id)!
  return { ok: true, loopRunId: approval.loop_run_id, allSubmitted, loopRun: updatedRun }
}
