import { randomUUID } from 'node:crypto'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { FastifyBaseLogger } from 'fastify'
import { getFeature, updateFeature } from '../../features.js'
import { getPlanet } from '../../planets.js'
import { getWorkflow, listWorkflows } from '../../workflows.js'
import type { RunRegistry } from '../../runState.js'
import type { SessionManager } from '../SessionManager.js'
import type { TerminalSessionManager } from '../TerminalSessionManager.js'
import type { TypedIOServer } from '../../socketTypes.js'
import { createFeatureWorktree } from '../worktrees.js'
import { runWorkflowOnSessions } from '../runWorkflowOnSessions.js'
import type { ScmAdapter } from '../../scm/types.js'
import { getAuditRecorder } from '../../AuditRecorder.js'
import { snapshotWorkflow } from '../../workflowSnapshot.js'

export interface RunFeatureWorkflowDeps {
  featureId: number
  planetId: number
  manager: SessionManager
  terminals?: TerminalSessionManager
  io: TypedIOServer
  runState: RunRegistry
  log: FastifyBaseLogger
  scm?: ScmAdapter
}

type WorkflowResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

/**
 * Core workflow execution — can be called directly (auto-trigger) or via the
 * `run_workflow` MCP tool (agent-driven). Returns a result object rather than
 * an MCP tool response so callers don't have to unwrap the tool shape.
 */
export async function executeFeatureWorkflow(
  deps: RunFeatureWorkflowDeps,
  args: { workflowId?: number } = {},
): Promise<WorkflowResult> {
  let feature = getFeature(deps.featureId)
  if (!feature) return { ok: false, message: `Feature ${deps.featureId} not found.` }

  const planet = getPlanet(deps.planetId)
  if (!planet) return { ok: false, message: `Planet ${deps.planetId} no longer exists.` }

  const workflowId = args.workflowId ?? planet.workflowId ?? listWorkflows()[0]?.id
  if (typeof workflowId !== 'number') {
    return { ok: false, message: 'No workflow is configured for this planet.' }
  }
  const wf = getWorkflow(workflowId)
  if (!wf) return { ok: false, message: `Workflow ${workflowId} not found.` }

  const activeFeatureId = deps.runState.activeFeatureId()
  if (activeFeatureId !== null && activeFeatureId !== deps.featureId) {
    const existing = getFeature(activeFeatureId)
    if (existing && existing.status === 'running') {
      return {
        ok: false,
        message: `A feature ("${existing.name}") is already running. Wait for it to complete.`,
      }
    }
  }
  if (activeFeatureId === deps.featureId && deps.runState.isInFlight()) {
    return { ok: false, message: 'This feature workflow is already running.' }
  }

  deps.runState.setActiveFeatureId(deps.featureId)

  let cwd: string
  try {
    const wt = await createFeatureWorktree({
      planetPath: planet.projectPath,
      featureId: feature.id,
      featureName: feature.name,
    })
    cwd = wt.path
    const afterWorktree = updateFeature(feature.id, {
      branch: wt.branch,
      worktreePath: wt.path,
      status: 'running',
    })!
    deps.io.emit('feature:updated', afterWorktree)
    feature = afterWorktree
  } catch (e) {
    const internalMsg = e instanceof Error ? e.message : String(e)
    const failed = updateFeature(feature.id, { status: 'failed', error: internalMsg })!
    deps.io.emit('feature:updated', failed)
    deps.runState.setActiveFeatureId(null)
    return { ok: false, message: `Failed to create worktree: ${internalMsg}` }
  }

  const controller = new AbortController()
  const featureId = feature.id
  const runId = randomUUID()
  const auditRecorder = getAuditRecorder()
  if (auditRecorder) {
    const snapshot = snapshotWorkflow(wf)
    auditRecorder.prepareRun(runId, {
      featureId: feature.id,
      workflowId: wf.id,
      workflowName: wf.name,
      snapshot,
      task: feature.task,
      branch: feature.branch,
      worktreePath: feature.worktreePath,
      cwd,
    })
  }
  const runPromise = runWorkflowOnSessions({
    workflow: wf,
    task: feature.task,
    manager: deps.manager,
    terminals: deps.terminals,
    io: deps.io,
    scm: deps.scm,
    featureId: deps.featureId,
    planetId: deps.planetId,
    ctx: { planetProjectPath: planet.projectPath },
    cwd,
    runId,
    signal: controller.signal,
    onAgentSpawned: auditRecorder
      ? (info, rid) => auditRecorder.onAgentSpawned(info, rid)
      : undefined,
    emit: (ev) => {
      deps.runState.emit(ev)
      if (auditRecorder) auditRecorder.onRunEvent(runId, ev)
      if (ev.type === 'node:started') {
        const updated = updateFeature(featureId, { status: ev.nodeId })
        if (updated) deps.io.emit('feature:updated', updated)
      } else if (ev.type === 'run:complete') {
        const updated = updateFeature(featureId, {
          status: 'complete',
          finalSummary: ev.finalSummary,
        })
        if (updated) deps.io.emit('feature:updated', updated)
      } else if (ev.type === 'run:failed') {
        const updated = updateFeature(featureId, {
          status: 'failed',
          error: ev.error,
        })
        if (updated) deps.io.emit('feature:updated', updated)
      }
    },
  }).catch((err) => {
    deps.log.error({ err }, 'run_workflow: workflow run failed')
    const updated = updateFeature(featureId, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    })
    if (updated) deps.io.emit('feature:updated', updated)
  })
  deps.runState.begin(feature.task, controller, runPromise)

  return {
    ok: true,
    message: `Workflow started for feature "${feature.name}" (#${feature.id}) on branch \`${feature.branch ?? '(pending)'}\`.`,
  }
}

export function createRunFeatureWorkflowTool(
  deps: RunFeatureWorkflowDeps,
): SdkMcpToolDefinition<any> {
  return tool(
    'run_workflow',
    'Start the workflow for this feature (creates branch + worktree, runs agents)',
    {
      workflowId: z
        .number()
        .optional()
        .describe('Workflow to run; omit to use planet default'),
    },
    async (args) => {
      const result = await executeFeatureWorkflow(deps, args)
      return result.ok
        ? { content: [{ type: 'text', text: result.message }] }
        : { isError: true, content: [{ type: 'text', text: result.message }] }
    },
  )
}
