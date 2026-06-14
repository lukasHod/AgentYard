import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import type { FastifyBaseLogger } from 'fastify'
import {
  createFeature,
  getFeature,
  updateFeature,
  type Feature,
} from '../../features.js'
import { getPlanet } from '../../planets.js'
import { getWorkflow, listWorkflows } from '../../workflows.js'
import type { RunRegistry } from '../../runState.js'
import type { SessionManager } from '../SessionManager.js'
import type { TerminalSessionManager } from '../TerminalSessionManager.js'
import type { TypedIOServer } from '../../socketTypes.js'
import { createFeatureWorktree } from '../worktrees.js'
import { runWorkflowOnSessions } from '../runWorkflowOnSessions.js'

export interface StartFeatureDeps {
  planetId: number
  manager: SessionManager
  terminals?: TerminalSessionManager
  io: TypedIOServer
  runState: RunRegistry
  log: FastifyBaseLogger
}

/**
 * Tool given to planet-chat agents so the user can spawn a feature from chat
 * instead of the form. Mirrors POST /api/planets/:id/features so behaviour
 * stays in sync — same gating (one active feature per server), same
 * worktree creation, same workflow runner, same socket events.
 */
export function createStartFeatureTool(deps: StartFeatureDeps) {
  return tool(
    'start_feature',
    'Start a new feature on this planet. Creates a git worktree off the planet\'s current branch and kicks off the planet\'s workflow against the task. Use this when the user wants you to BUILD something (not just answer questions). Confirm the task wording with the user first if it is ambiguous.',
    {
      name: z
        .string()
        .min(1)
        .describe(
          'Short slug-style name for the feature, e.g. "add-dark-mode". Used in the branch name and feature row.',
        ),
      task: z
        .string()
        .min(1)
        .describe(
          'The full task description that gets handed to the workflow. Write it as a clear, self-contained instruction — what to build, where, and any constraints. The leader agent reads this verbatim.',
        ),
    },
    async (args) => {
      const planet = getPlanet(deps.planetId)
      if (!planet) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Planet ${deps.planetId} no longer exists.` }],
        }
      }

      const activeFeatureId = deps.runState.activeFeatureId()
      if (activeFeatureId !== null) {
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

      const workflowId = planet.workflowId ?? listWorkflows()[0]?.id
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

      let feature: Feature = createFeature({
        planetId: planet.id,
        name: args.name.trim(),
        task: args.task,
        workflowId,
      })
      deps.runState.setActiveFeatureId(feature.id)
      deps.io.emit('feature:created', feature)

      let cwd: string
      try {
        const wt = await createFeatureWorktree({
          planetPath: planet.projectPath,
          featureId: feature.id,
          featureName: feature.name,
        })
        cwd = wt.path
        feature = updateFeature(feature.id, {
          branch: wt.branch,
          worktreePath: wt.path,
          status: 'running',
        })!
        deps.io.emit('feature:updated', feature)
      } catch (e) {
        const internalMsg = e instanceof Error ? e.message : String(e)
        feature = updateFeature(feature.id, { status: 'failed', error: internalMsg })!
        deps.io.emit('feature:updated', feature)
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
        task: args.task,
        manager: deps.manager,
        terminals: deps.terminals,
        io: deps.io,
        featureId: feature.id,
        planetId: planet.id,
        ctx: { planetProjectPath: planet.projectPath },
        cwd,
        signal: controller.signal,
        emit: (ev) => {
          deps.runState.emit(ev)
          if (ev.type === 'run:complete') {
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
        deps.log.error({ err }, 'start_feature: workflow run failed')
        const updated = updateFeature(featureId, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
        if (updated) deps.io.emit('feature:updated', updated)
      })
      deps.runState.begin(args.task, controller, runPromise)

      return {
        content: [
          {
            type: 'text',
            text: `Feature "${feature.name}" (#${feature.id}) created on branch \`${feature.branch ?? '?'}\` — workflow is running. You can follow progress in the Run view or in the planet's features tab.`,
          },
        ],
      }
    },
  )
}
