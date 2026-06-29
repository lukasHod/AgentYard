import {
  createFeature,
  deleteFeature,
  getFeature,
  listFeatures,
  updateFeature,
} from '../features.js'
import { removeFeatureWorktree } from '../runtime/worktrees.js'
import { getPlanet } from '../planets.js'
import { getDefaultWorkflowIdForNewFeatures } from '../workflows.js'
import { executeFeatureWorkflow } from '../runtime/tools/runFeatureWorkflow.js'
import type { AppContext } from './context.js'
import { parseRequestPart, parseRouteId } from './validation.js'
import { z } from 'zod/v4'

const WatchingBodySchema = z.object({ enabled: z.boolean().optional() }).default({})

export function registerFeatureRoutes(ctx: AppContext): void {
  const { app, io, manager, apiError } = ctx

  app.get<{ Params: { id: string } }>('/api/planets/:id/features', async (req, reply) => {
    const planetId = parseRouteId('planet id', req.params.id, reply)
    if (planetId === null) return
    const planet = getPlanet(planetId)
    if (!planet) return reply.code(404).send({ error: 'planet not found' })
    return listFeatures(planet.id)
  })

  app.get<{ Params: { id: string } }>('/api/features/:id', async (req, reply) => {
    const featureId = parseRouteId('feature id', req.params.id, reply)
    if (featureId === null) return
    const feature = getFeature(featureId)
    if (!feature) return reply.code(404).send({ error: 'not found' })
    return feature
  })

  app.post<{
    Params: { id: string }
  }>('/api/planets/:id/features', async (req, reply) => {
    const planetId = parseRouteId('planet id', req.params.id, reply)
    if (planetId === null) return
    const planet = getPlanet(planetId)
    if (!planet) return reply.code(404).send({ error: 'planet not found' })

    const name = `feature-${Date.now()}`
    const workflowId = planet.workflowId ?? getDefaultWorkflowIdForNewFeatures()
    const feature = createFeature({ planetId: planet.id, name, task: '', workflowId })
    io.emit('feature:created', feature)

    executeFeatureWorkflow({
      featureId: feature.id,
      planetId: planet.id,
      manager: ctx.manager,
      terminals: ctx.terminals,
      io,
      runState: ctx.runState,
      log: app.log,
      scm: ctx.scm,
    }).catch((err) => {
      app.log.error({ err }, 'auto-trigger workflow failed on feature creation')
    })

    return feature
  })

  app.post<{ Params: { id: string } }>('/api/features/:id/chat/open', async (req, reply) => {
    const featureId = parseRouteId('feature id', req.params.id, reply)
    if (featureId === null) return
    const feature = getFeature(featureId)
    if (!feature) return reply.code(404).send({ error: 'feature not found' })
    if (!ctx.featureChats) {
      return apiError(reply, 503, 'feature chat not available yet')
    }
    try {
      const session = ctx.featureChats.openChat(featureId)
      return manager.describe(session)
    } catch (e) {
      return apiError(reply, 500, 'failed to open feature chat', e)
    }
  })

  app.post<{ Params: { id: string }; Body: { enabled?: boolean } }>(
    '/api/features/:id/watching',
    async (req, reply) => {
      const featureId = parseRouteId('feature id', req.params.id, reply)
      if (featureId === null) return
      const body = parseRequestPart('body', req.body, WatchingBodySchema, reply)
      if (!body) return
      const feature = getFeature(featureId)
      if (!feature) return reply.code(404).send({ error: 'feature not found' })
      const enabled = body.enabled ?? false
      const updated = updateFeature(featureId, { watchingEnabled: enabled })
      if (updated) io.emit('feature:updated', updated)
      // If enabling and PR metadata is already present, trigger an immediate poll.
      if (enabled && feature.prNumber && ctx.prWatcher) {
        void ctx.prWatcher.pollFeature({ ...feature, watchingEnabled: true })
      }
      return { ok: true, watchingEnabled: enabled }
    },
  )

  app.post<{ Params: { id: string } }>('/api/features/:id/done', async (req, reply) => {
    const featureId = parseRouteId('feature id', req.params.id, reply)
    if (featureId === null) return
    const feature = getFeature(featureId)
    if (!feature) return reply.code(404).send({ error: 'feature not found' })
    const updated = updateFeature(featureId, { status: 'done' })
    if (updated) io.emit('feature:updated', updated)
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/features/:id', async (req, reply) => {
    const featureId = parseRouteId('feature id', req.params.id, reply)
    if (featureId === null) return
    const feature = getFeature(featureId)
    if (!feature) return reply.code(404).send({ error: 'feature not found' })

    try {
      // Stop all in-flight workflow runs and kill all terminal sessions for
      // this feature before touching the DB so no orphaned processes remain.
      await Promise.all([
        ctx.runState.abortRunsForFeature(featureId),
        ctx.terminals.deleteForFeature(featureId),
      ])

      if (ctx.featureChats) {
        await ctx.featureChats.deleteForFeature(featureId)
      }

      if (feature.worktreePath) {
        const planet = getPlanet(feature.planetId)
        if (planet) {
          await removeFeatureWorktree(planet.projectPath, feature.worktreePath)
        }
      }
    } finally {
      deleteFeature(featureId)
    }

    io.emit('feature:deleted', { id: featureId })
    return { ok: true }
  })
}
