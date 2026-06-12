import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { FastifyBaseLogger } from 'fastify'
import { getFeature, updateFeature } from '../../features.js'
import { getPlanet } from '../../planets.js'
import { getWorkflow, listWorkflows } from '../../workflows.js'
import type { RunRegistry } from '../../runState.js'
import type { SessionManager } from '../SessionManager.js'
import type { TypedIOServer } from '../../socketTypes.js'
import { createFeatureWorktree } from '../worktrees.js'
import { runWorkflowOnSessions } from '../runWorkflowOnSessions.js'

export function createRunFeatureWorkflowTool(deps: {
  featureId: number
  planetId: number
  manager: SessionManager
  io: TypedIOServer
  runState: RunRegistry
  log: FastifyBaseLogger
}): SdkMcpToolDefinition<any> {
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
      let feature = getFeature(deps.featureId)
      if (!feature) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Feature ${deps.featureId} not found.` }],
        }
      }

      const planet = getPlanet(deps.planetId)
      if (!planet) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Planet ${deps.planetId} no longer exists.` }],
        }
      }

      const workflowId = args.workflowId ?? planet.workflowId ?? listWorkflows()[0]?.id
      if (typeof workflowId !== 'number') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'No workflow is configured for this planet.' }],
        }
      }
      const wf = getWorkflow(workflowId)
      if (!wf) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Workflow ${workflowId} not found.` }],
        }
      }

      const activeFeatureId = deps.runState.activeFeatureId()
      if (activeFeatureId !== null && activeFeatureId !== deps.featureId) {
        const existing = getFeature(activeFeatureId)
        if (existing && existing.status === 'running') {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `A feature ("${existing.name}") is already running. Wait for it to complete or have the user reset the run before starting another.`,
              },
            ],
          }
        }
      }
      if (activeFeatureId === deps.featureId && deps.runState.isInFlight()) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'This feature workflow is already running.' }],
        }
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
        return {
          isError: true,
          content: [
            { type: 'text', text: `Failed to create worktree for feature: ${internalMsg}` },
          ],
        }
      }

      const controller = new AbortController()
      const featureId = feature.id
      const runPromise = runWorkflowOnSessions({
        workflow: wf,
        task: feature.task,
        manager: deps.manager,
        ctx: { planetProjectPath: planet.projectPath },
        cwd,
        signal: controller.signal,
        emit: (ev) => {
          deps.runState.emit(ev)
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
        content: [
          {
            type: 'text',
            text: `Workflow started for feature "${feature.name}" (#${feature.id}) on branch \`${feature.branch ?? '(pending)'}\`. You can follow progress in the Run view.`,
          },
        ],
      }
    },
  )
}
