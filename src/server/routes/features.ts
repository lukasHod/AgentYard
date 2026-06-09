import {
  createFeature,
  getFeature,
  listFeatures,
  updateFeature,
  type Feature,
} from '../features.js'
import { formatHandoffContext, type HandoffPayload } from '../handoff.js'
import { runWorkflowOnSessions } from '../runtime/runWorkflowOnSessions.js'
import { createFeatureWorktree, removeFeatureWorktree } from '../runtime/worktrees.js'
import { getPlanet } from '../planets.js'
import { getWorkflow, listWorkflows } from '../workflows.js'
import type { AppContext } from './context.js'

export function registerFeatureRoutes(ctx: AppContext): void {
  const { app, io, manager, runState, apiError } = ctx

  app.get<{ Params: { id: string } }>('/api/planets/:id/features', async (req, reply) => {
    const planet = getPlanet(Number(req.params.id))
    if (!planet) return reply.code(404).send({ error: 'planet not found' })
    return listFeatures(planet.id)
  })

  app.get<{ Params: { id: string } }>('/api/features/:id', async (req, reply) => {
    const feature = getFeature(Number(req.params.id))
    if (!feature) return reply.code(404).send({ error: 'not found' })
    return feature
  })

  app.post<{
    Params: { id: string }
    Body: { name?: string; task?: string; workflowId?: number }
  }>('/api/planets/:id/features', async (req, reply) => {
    const planet = getPlanet(Number(req.params.id))
    if (!planet) return reply.code(404).send({ error: 'planet not found' })
    const task = req.body.task?.trim()
    if (!task) return reply.code(400).send({ error: 'task required' })

    const activeFeatureId = runState.activeFeatureId()
    if (activeFeatureId !== null) {
      const existing = getFeature(activeFeatureId)
      if (existing && existing.status === 'running') {
        return reply.code(409).send({ error: 'a feature is already running; reset first' })
      }
    }

    const workflowId = req.body.workflowId ?? planet.workflowId ?? listWorkflows()[0]?.id
    if (typeof workflowId !== 'number') {
      return reply.code(400).send({ error: 'no workflow available' })
    }
    const wf = getWorkflow(workflowId)
    if (!wf) return reply.code(404).send({ error: 'workflow not found' })

    const name = req.body.name?.trim() || `feature-${Date.now()}`
    let feature: Feature = createFeature({ planetId: planet.id, name, task, workflowId })
    runState.setActiveFeatureId(feature.id)
    io.emit('feature:created', feature)

    // Create the worktree.
    let cwd: string | undefined
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
      io.emit('feature:updated', feature)
    } catch (e) {
      // Persist the raw error onto the feature row so the UI can display it;
      // the HTTP response stays generic since it may contain internal paths.
      const internalMsg = e instanceof Error ? e.message : String(e)
      feature = updateFeature(feature.id, { status: 'failed', error: internalMsg })!
      io.emit('feature:updated', feature)
      return apiError(reply, 500, 'worktree creation failed', e)
    }

    // If this feature was picked up from a handoff, inject prior conversation context.
    let handoffContext: string | undefined
    if (feature.handoffContext) {
      try {
        const payload = JSON.parse(feature.handoffContext) as HandoffPayload
        handoffContext = formatHandoffContext(payload)
      } catch {
        // Malformed handoff context — skip injection rather than crashing.
      }
    }

    const controller = new AbortController()
    const runPromise = runWorkflowOnSessions({
      workflow: wf,
      task,
      manager,
      ctx: { planetProjectPath: planet.projectPath },
      cwd,
      signal: controller.signal,
      handoffContext,
      emit: (ev) => {
        runState.emit(ev)
        if (ev.type === 'run:complete') {
          const updated = updateFeature(feature.id, {
            status: 'complete',
            finalSummary: ev.finalSummary,
          })
          if (updated) io.emit('feature:updated', updated)
        } else if (ev.type === 'run:failed') {
          const updated = updateFeature(feature.id, {
            status: 'failed',
            error: ev.error,
          })
          if (updated) io.emit('feature:updated', updated)
        }
      },
    }).catch((err) => {
      app.log.error({ err }, 'feature run failed')
      const updated = updateFeature(feature.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
      if (updated) io.emit('feature:updated', updated)
    })
    runState.begin(task, controller, runPromise)

    return { ok: true, feature }
  })

  app.post<{ Params: { id: string } }>('/api/features/:id/teardown', async (req) => {
    const feature = getFeature(Number(req.params.id))
    if (!feature) return { ok: false }
    if (feature.worktreePath) {
      const planet = getPlanet(feature.planetId)
      if (planet) await removeFeatureWorktree(planet.projectPath, feature.worktreePath)
    }
    return { ok: true }
  })
}
