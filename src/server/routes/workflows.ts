import { WorkflowGraphSchema } from '../../core/schema.js'
import { getWorkflow, listWorkflows, updateWorkflow } from '../workflows.js'
import type { AppContext } from './context.js'

export function registerWorkflowRoutes({ app }: AppContext): void {
  app.get('/api/workflows', async () => listWorkflows())

  app.get<{ Params: { id: string } }>('/api/workflows/:id', async (req, reply) => {
    const wf = getWorkflow(Number(req.params.id))
    if (!wf) return reply.code(404).send({ error: 'not found' })
    return wf
  })

  app.put<{ Params: { id: string }; Body: { name?: string; graph?: unknown } }>(
    '/api/workflows/:id',
    async (req, reply) => {
      const id = Number(req.params.id)
      const patch: { name?: string; graph?: ReturnType<typeof WorkflowGraphSchema.parse> } = {}
      if (typeof req.body.name === 'string') patch.name = req.body.name
      if (req.body.graph !== undefined) {
        const parsed = WorkflowGraphSchema.safeParse(req.body.graph)
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
        patch.graph = parsed.data
      }
      const wf = updateWorkflow(id, patch)
      if (!wf) return reply.code(404).send({ error: 'not found' })
      return wf
    },
  )
}
