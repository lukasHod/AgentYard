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
import type { AppContext } from './context.js'

export function registerFeatureRoutes(ctx: AppContext): void {
  const { app, io, manager, apiError } = ctx

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
  }>('/api/planets/:id/features', async (req, reply) => {
    const planet = getPlanet(Number(req.params.id))
    if (!planet) return reply.code(404).send({ error: 'planet not found' })

    const name = `feature-${Date.now()}`
    // Phase 8a: new features default to the AO development lifecycle.
    const workflowId = getDefaultWorkflowIdForNewFeatures()
    const feature = createFeature({ planetId: planet.id, name, task: '', workflowId })
    io.emit('feature:created', feature)
    return { ok: true, feature }
  })

  app.post<{ Params: { id: string } }>('/api/features/:id/chat/open', async (req, reply) => {
    const featureId = Number(req.params.id)
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

  app.post<{ Params: { id: string } }>('/api/features/:id/done', async (req, reply) => {
    const featureId = Number(req.params.id)
    const feature = getFeature(featureId)
    if (!feature) return reply.code(404).send({ error: 'feature not found' })
    const updated = updateFeature(featureId, { status: 'done' })
    if (updated) io.emit('feature:updated', updated)
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/features/:id', async (req, reply) => {
    const featureId = Number(req.params.id)
    const feature = getFeature(featureId)
    if (!feature) return reply.code(404).send({ error: 'feature not found' })

    try {
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
