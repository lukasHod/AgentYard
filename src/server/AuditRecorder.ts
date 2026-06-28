import type { RunEvent } from '../core/executor.js'
import type { SessionEvent } from './runtime/Session.js'
import { getDb } from './db.js'
import {
  initAuditRun,
  updateAuditRun,
  initAuditNodeRun,
  updateAuditNodeRun,
  createNodeAttempt,
  updateNodeAttempt,
  getLatestAttemptId,
  upsertSessionCapabilities,
  insertAuditEvent,
} from './auditRepository.js'
import type { WorkflowSnapshot } from './workflowSnapshot.js'
import type { FastifyBaseLogger } from 'fastify'

export interface AgentSpawnedInfo {
  sessionId: string
  nodeId: string
  agentName: string
  role: string
  runtimeKind: 'claude-sdk' | 'claude-code-cli' | 'codex-cli'
  model?: string
  cwd?: string
  skillNames: string[]
  scriptNames: string[]
  mcpNames: string[]
  toolPreset?: string
  allowedTools?: string[]
  effectiveTools?: string[]
  permissionMode?: string
  enforcementStatus: 'verified' | 'partial' | 'unknown'
  enforcementReason?: string
}

interface PendingRun {
  featureId: number
  workflowId: number
  workflowName: string
  snapshot: WorkflowSnapshot
  branch?: string | null
  worktreePath?: string | null
  cwd?: string | null
  task: string
}

/**
 * Observer that converts executor RunEvents and SDK SessionEvents into
 * persistent audit records. Wired at server startup as a side-channel
 * subscriber — never modifies execution flow.
 */
export class AuditRecorder {
  /** Pending run data indexed by runId — set before the workflow starts. */
  private pendingRuns = new Map<string, PendingRun>()
  /** Map nodeId → node_run DB id (UUID) for the current in-flight run. */
  private nodeRunIds = new Map<string, string>()
  /** Map node_run DB id → current attempt DB row id. */
  private attemptIds = new Map<string, number>()
  /** Map sessionId → runId. */
  private sessionRunIds = new Map<string, string>()

  constructor(private log?: FastifyBaseLogger) {}

  /**
   * Call this BEFORE runWorkflowOnSessions to stash the snapshot so it's
   * available when run:started arrives.
   */
  prepareRun(
    runId: string,
    info: {
      featureId: number
      workflowId: number
      workflowName: string
      snapshot: WorkflowSnapshot
      task: string
      branch?: string | null
      worktreePath?: string | null
      cwd?: string | null
    },
  ): void {
    this.pendingRuns.set(runId, info)
  }

  /** Called for every RunEvent emitted by the executor. */
  onRunEvent(runId: string, ev: RunEvent): void {
    try {
      this._onRunEvent(runId, ev)
    } catch (err) {
      this.log?.warn({ err, ev }, 'AuditRecorder.onRunEvent failed')
    }
  }

  private _onRunEvent(runId: string, ev: RunEvent): void {
    switch (ev.type) {
      case 'run:started': {
        const pending = this.pendingRuns.get(runId)
        if (!pending) {
          this.log?.warn({ runId }, 'AuditRecorder: no pending run data for run:started')
          return
        }
        initAuditRun({
          id: runId,
          featureId: pending.featureId,
          workflowId: pending.workflowId,
          workflowName: pending.workflowName,
          workflowSnapshotJson: pending.snapshot.json,
          workflowSnapshotHash: pending.snapshot.hash,
          task: pending.task,
          branch: pending.branch,
          worktreePath: pending.worktreePath,
          cwd: pending.cwd,
        })
        updateAuditRun(runId, { state: 'running' })
        insertAuditEvent({
          runId,
          eventType: 'workflow_started',
          title: `Workflow "${pending.workflowName}" started`,
          summary: `Task: ${pending.task}`,
          severity: 'info',
        })
        this.pendingRuns.delete(runId)
        break
      }

      case 'node:started': {
        const node = ev as Extract<RunEvent, { type: 'node:started' }>
        const nodeRunId = initAuditNodeRun({
          runId,
          nodeId: node.nodeId,
          title: node.title,
        })
        this.nodeRunIds.set(node.nodeId, nodeRunId)
        const attemptId = createNodeAttempt(runId, nodeRunId, 1)
        this.attemptIds.set(nodeRunId, attemptId)
        insertAuditEvent({
          runId,
          nodeRunId,
          nodeAttemptId: attemptId,
          eventType: 'node_started',
          title: `Node "${node.title}" started`,
          severity: 'info',
        })
        break
      }

      case 'node:complete': {
        const node = ev as Extract<RunEvent, { type: 'node:complete' }>
        const nodeRunId = this.nodeRunIds.get(node.nodeId)
        if (!nodeRunId) break
        const attemptId = this.attemptIds.get(nodeRunId)
        const now = Date.now()
        updateAuditNodeRun(nodeRunId, { state: 'complete', summary: node.summary, endedAt: now })
        if (attemptId) {
          updateNodeAttempt(attemptId, { status: 'complete', summary: node.summary, completedAt: now })
        }
        insertAuditEvent({
          runId,
          nodeRunId,
          nodeAttemptId: attemptId ?? null,
          eventType: 'node_completed',
          title: `Node "${node.title}" completed`,
          summary: node.summary,
          severity: 'success',
        })
        break
      }

      case 'node:skipped': {
        const node = ev as Extract<RunEvent, { type: 'node:skipped' }>
        const existingNodeRunId = this.nodeRunIds.get(node.nodeId)
        let nodeRunId = existingNodeRunId
        if (!nodeRunId) {
          nodeRunId = initAuditNodeRun({ runId, nodeId: node.nodeId, title: node.title })
          this.nodeRunIds.set(node.nodeId, nodeRunId)
        }
        updateAuditNodeRun(nodeRunId, { state: 'skipped', endedAt: Date.now() })
        insertAuditEvent({
          runId,
          nodeRunId,
          eventType: 'node_skipped',
          title: `Node "${node.title}" skipped`,
          severity: 'info',
        })
        break
      }

      case 'run:complete': {
        const ev2 = ev as Extract<RunEvent, { type: 'run:complete' }>
        updateAuditRun(runId, {
          state: 'done',
          finalSummary: ev2.finalSummary,
          completedAt: Date.now(),
        })
        insertAuditEvent({
          runId,
          eventType: 'workflow_completed',
          title: 'Workflow completed',
          summary: ev2.finalSummary,
          severity: 'success',
        })
        this._cleanupRunState()
        break
      }

      case 'run:failed': {
        const ev2 = ev as Extract<RunEvent, { type: 'run:failed' }>
        const nodeRunId = ev2.nodeId ? this.nodeRunIds.get(ev2.nodeId) : undefined
        if (nodeRunId) {
          const attemptId = this.attemptIds.get(nodeRunId)
          const now = Date.now()
          updateAuditNodeRun(nodeRunId, { state: 'failed', endedAt: now })
          if (attemptId) {
            updateNodeAttempt(attemptId, { status: 'failed', error: ev2.error, completedAt: now })
          }
          insertAuditEvent({
            runId,
            nodeRunId,
            nodeAttemptId: attemptId ?? null,
            eventType: 'node_failed',
            title: `Node failed: ${ev2.error}`,
            severity: 'error',
          })
        }
        updateAuditRun(runId, {
          state: 'terminated',
          error: ev2.error,
          completedAt: Date.now(),
        })
        insertAuditEvent({
          runId,
          nodeRunId: nodeRunId ?? null,
          eventType: 'workflow_failed',
          title: `Workflow failed: ${ev2.error}`,
          severity: 'error',
        })
        this._cleanupRunState()
        break
      }
    }
  }

  /** Called for every SessionEvent from SessionManager. */
  onSessionEvent(ev: SessionEvent): void {
    try {
      this._onSessionEvent(ev)
    } catch (err) {
      this.log?.warn({ err, evType: ev.type }, 'AuditRecorder.onSessionEvent failed')
    }
  }

  private _onSessionEvent(ev: SessionEvent): void {
    const sessionId = ev.agentRunId
    const runId = this.sessionRunIds.get(sessionId)
    if (!runId) return

    switch (ev.type) {
      case 'tool_use': {
        const nodeRunId = this._nodeRunIdForSession(sessionId)
        const attemptId = nodeRunId ? this.attemptIds.get(nodeRunId) : null
        const isAssignTask = ev.tool.endsWith('assign_task')
        insertAuditEvent({
          runId,
          nodeRunId: nodeRunId ?? null,
          nodeAttemptId: attemptId ?? null,
          sessionId,
          eventType: isAssignTask ? 'leader_delegated' : 'tool_used',
          title: isAssignTask
            ? `Leader delegated task`
            : `Tool used: ${ev.tool}`,
          details: { tool: ev.tool, toolUseId: ev.toolUseId },
          severity: 'info',
        })
        break
      }

      case 'clarification:requested': {
        const nodeRunId = this._nodeRunIdForSession(sessionId)
        const attemptId = nodeRunId ? this.attemptIds.get(nodeRunId) : null
        insertAuditEvent({
          runId,
          nodeRunId: nodeRunId ?? null,
          nodeAttemptId: attemptId ?? null,
          sessionId,
          eventType: 'clarification_requested',
          title: 'Agent asked a question',
          severity: 'warning',
        })
        break
      }

      case 'clarification:resolved': {
        const nodeRunId = this._nodeRunIdForSession(sessionId)
        const attemptId = nodeRunId ? this.attemptIds.get(nodeRunId) : null
        insertAuditEvent({
          runId,
          nodeRunId: nodeRunId ?? null,
          nodeAttemptId: attemptId ?? null,
          sessionId,
          eventType: 'clarification_answered',
          title: 'User answered question',
          severity: 'info',
        })
        break
      }

      case 'closed': {
        const nodeRunId = this._nodeRunIdForSession(sessionId)
        const attemptId = nodeRunId ? this.attemptIds.get(nodeRunId) : null
        insertAuditEvent({
          runId,
          nodeRunId: nodeRunId ?? null,
          nodeAttemptId: attemptId ?? null,
          sessionId,
          eventType: 'agent_completed',
          title: 'Agent session closed',
          severity: 'info',
        })
        this.sessionRunIds.delete(sessionId)
        break
      }
    }
  }

  /** Called after each drone or leader is spawned. */
  onAgentSpawned(info: AgentSpawnedInfo, runId: string): void {
    try {
      this._onAgentSpawned(info, runId)
    } catch (err) {
      this.log?.warn({ err, sessionId: info.sessionId }, 'AuditRecorder.onAgentSpawned failed')
    }
  }

  private _onAgentSpawned(info: AgentSpawnedInfo, runId: string): void {
    this.sessionRunIds.set(info.sessionId, runId)
    const nodeRunId = this.nodeRunIds.get(info.nodeId) ?? null

    upsertSessionCapabilities(info.sessionId, {
      agentName: info.agentName,
      model: info.model,
      skillNames: info.skillNames,
      scriptNames: info.scriptNames,
      mcpNames: info.mcpNames,
      toolPreset: info.toolPreset,
      allowedTools: info.allowedTools,
      effectiveTools: info.effectiveTools,
      permissionMode: info.permissionMode,
      enforcementStatus: info.enforcementStatus,
      enforcementReason: info.enforcementReason,
      nodeRunId: nodeRunId ?? undefined,
    })

    const attemptId = nodeRunId ? this.attemptIds.get(nodeRunId) : null
    insertAuditEvent({
      runId,
      nodeRunId,
      nodeAttemptId: attemptId ?? null,
      sessionId: info.sessionId,
      eventType: 'agent_spawned',
      title: `Agent "${info.agentName}" spawned (${info.role})`,
      summary: info.enforcementStatus === 'partial' ? `Enforcement: partial — ${info.enforcementReason}` : undefined,
      details: {
        runtimeKind: info.runtimeKind,
        model: info.model,
        skillCount: info.skillNames.length,
        mcpCount: info.mcpNames.length,
        enforcementStatus: info.enforcementStatus,
      },
      severity: info.enforcementStatus === 'partial' ? 'warning' : 'info',
    })
  }

  private _nodeRunIdForSession(sessionId: string): string | null {
    const row = getDb().prepare('SELECT node_run_id FROM runner_sessions WHERE id = ?').get(sessionId) as { node_run_id: string | null } | undefined
    return row?.node_run_id ?? null
  }

  private _cleanupRunState(): void {
    this.nodeRunIds.clear()
    this.attemptIds.clear()
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

let _instance: AuditRecorder | null = null

export function setAuditRecorder(recorder: AuditRecorder): void {
  _instance = recorder
}

export function getAuditRecorder(): AuditRecorder | null {
  return _instance
}
