import { z } from 'zod/v4'
import {
  listAuditRunsForFeature,
  getAuditRunDetail,
  listAuditEvents,
} from '../auditRepository.js'
import { getFeature } from '../features.js'
import type { AppContext } from './context.js'
import { parseRequestPart, parseRouteId } from './validation.js'

const EventQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  nodeRunId: z.string().optional(),
  sessionId: z.string().optional(),
  eventType: z.string().optional(),
  severity: z.enum(['info', 'success', 'warning', 'error']).optional(),
})

export function registerAuditRunRoutes(ctx: AppContext): void {
  const { app, apiError } = ctx

  /** List all workflow runs for a feature, newest first. */
  app.get<{ Params: { featureId: string } }>(
    '/api/features/:featureId/runs',
    async (req, reply) => {
      const featureId = parseRouteId('feature id', req.params.featureId, reply)
      if (featureId === null) return
      const feature = getFeature(featureId)
      if (!feature) return reply.code(404).send({ error: 'feature not found' })
      try {
        return listAuditRunsForFeature(featureId)
      } catch (err) {
        return apiError(reply, 500, 'failed to list runs', err)
      }
    },
  )

  /** Get full run detail: run metadata, node runs, attempts, sessions. */
  app.get<{ Params: { runId: string } }>(
    '/api/workflow-runs/:runId',
    async (req, reply) => {
      const runId = req.params.runId
      if (!runId) return reply.code(400).send({ error: 'invalid run id' })
      try {
        const detail = getAuditRunDetail(runId)
        if (!detail) return reply.code(404).send({ error: 'run not found' })
        return detail
      } catch (err) {
        return apiError(reply, 500, 'failed to get run detail', err)
      }
    },
  )

  /** Paginated audit event list for a run. */
  app.get<{ Params: { runId: string }; Querystring: Record<string, unknown> }>(
    '/api/workflow-runs/:runId/events',
    async (req, reply) => {
      const runId = req.params.runId
      if (!runId) return reply.code(400).send({ error: 'invalid run id' })

      const query = parseRequestPart('query', req.query, EventQuerySchema, reply)
      if (query === null) return

      try {
        const result = listAuditEvents(runId, {
          cursor: query.cursor,
          limit: query.limit,
          nodeRunId: query.nodeRunId,
          sessionId: query.sessionId,
          eventType: query.eventType,
          severity: query.severity,
        })
        return result
      } catch (err) {
        return apiError(reply, 500, 'failed to list events', err)
      }
    },
  )
}
