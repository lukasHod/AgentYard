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

      // Phase 7: route through the multi-run admit check. /api/runs is used
      // for ad-hoc workflow execution without a feature, so we only gate on
      // global capacity here.
      const verdict = runState.canBegin({})
      if (!verdict.ok) {
        const reason = verdict.reason
        const message =
          reason === 'global-capacity'
            ? 'Global concurrent run limit reached; cancel one or wait.'
            : reason === 'planet-capacity'
              ? 'Planet concurrent run limit reached.'
              : 'This feature already has a run in flight.'
        return reply.code(409).send({ error: message, reason })
      }

      const controller = new AbortController()
      const runPromise = runWorkflowOnSessions({
        workflow: wf,
        task,
        manager,
        ctx: { planetProjectPath: null }, // no planet context — global tools only
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

  // Phase 9 dashboard support: list every tracked run snapshot.
  app.get('/api/runs/snapshots', async () => runState.allSnapshots())

  // Phase 9 quick-action: cancel a specific run by id.
  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (req, reply) => {
    const runId = req.params.id
    if (!runState.snapshotById(runId)) {
      return reply.code(404).send({ error: 'run not found' })
    }
    await runState.abortRun(runId)
    return { ok: true }
  })
}
