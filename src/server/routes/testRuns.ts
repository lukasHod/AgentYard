import { getShip } from '../ships.js'
import { getWorkflow } from '../workflows.js'
import type { AppContext } from './context.js'

export function registerTestRunRoutes({ app, testRuns, apiError }: AppContext): void {
  app.post<{
    Body: {
      shipId?: number
      workflowId?: number
      task?: string
      scope?: 'workflow' | 'node'
      nodeId?: string
      upstreamOutputs?: string
    }
  }>('/api/test-runs', async (req, reply) => {
    const { shipId, workflowId, task, scope, nodeId, upstreamOutputs } = req.body ?? {}
    if (typeof shipId !== 'number') return reply.code(400).send({ error: 'shipId is required' })
    if (typeof workflowId !== 'number')
      return reply.code(400).send({ error: 'workflowId is required' })
    if (typeof task !== 'string' || task.trim().length === 0)
      return reply.code(400).send({ error: 'task is required' })
    if (scope !== 'workflow' && scope !== 'node')
      return reply.code(400).send({ error: "scope must be 'workflow' or 'node'" })
    if (scope === 'node' && (typeof nodeId !== 'string' || nodeId.length === 0))
      return reply.code(400).send({ error: 'nodeId is required for scope=node' })

    const ship = getShip(shipId)
    if (!ship) return reply.code(404).send({ error: 'ship not found' })
    const wf = getWorkflow(workflowId)
    if (!wf) return reply.code(404).send({ error: 'workflow not found' })

    try {
      const testRunId = await testRuns.start({
        ship,
        workflow: wf,
        task,
        scope,
        nodeId,
        upstreamOutputs,
      })
      return { ok: true, testRunId }
    } catch (err) {
      return apiError(reply, 500, 'failed to start test run', err)
    }
  })

  app.post<{ Params: { id: string } }>('/api/test-runs/:id/abort', async (req) => {
    await testRuns.abort(req.params.id)
    return { ok: true }
  })
}
