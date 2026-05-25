import { runWorkflowOnSessions } from '../runtime/runWorkflowOnSessions.js'
import { getWorkflow, listWorkflows } from '../workflows.js'
import type { AppContext } from './context.js'

export function registerRunRoutes(ctx: AppContext): void {
  const { app, manager, runState, transcripts } = ctx

  app.post<{ Body: { workflowId?: number; task?: string } }>(
    '/api/runs',
    async (req, reply) => {
      const body = req.body ?? {}
      const wfId = body.workflowId ?? listWorkflows()[0]?.id
      if (typeof wfId !== 'number') {
        return reply.code(400).send({ error: 'No workflow available' })
      }
      const wf = getWorkflow(wfId)
      if (!wf) return reply.code(404).send({ error: 'workflow not found' })
      const task = body.task?.trim()
      if (!task) return reply.code(400).send({ error: 'task is required' })

      if (runState.isInFlight()) {
        return reply.code(409).send({ error: 'A run is already in flight; reset first.' })
      }

      const controller = new AbortController()
      const runPromise = runWorkflowOnSessions({
        workflow: wf,
        task,
        manager,
        ctx: { shipProjectPath: null }, // no ship context — global tools only
        signal: controller.signal,
        emit: (ev) => runState.emit(ev),
      }).catch((err) => {
        app.log.error({ err }, 'workflow run failed')
        runState.setError(err instanceof Error ? err.message : String(err))
        return null
      })
      runState.begin(task, controller, runPromise)

      const runId = await runPromise
      return { ok: true, runId: runId ?? runState.snapshot()?.runId }
    },
  )

  app.post('/api/runs/reset', async () => {
    await runState.reset()
    await manager.destroyAll()
    transcripts.clear()
    return { ok: true }
  })
}
