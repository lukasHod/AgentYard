import type { AppContext } from './context.js'
import { buildHandoffContext, renderHandoffMarkdown } from '../handoffSummary.js'
import { getTerminalSession } from '../terminalStore.js'

export function registerTerminalRoutes({ app, apiError }: AppContext): void {
  app.get<{ Params: { id: string } }>('/api/terminals/:id/handoff-summary', async (req, reply) => {
    const session = getTerminalSession(req.params.id)
    if (!session) return reply.code(404).send({ error: 'session not found' })
    try {
      const context = buildHandoffContext(session)
      return { markdown: renderHandoffMarkdown(context), context }
    } catch (err) {
      return apiError(reply, 500, 'failed to build handoff summary', err)
    }
  })
}
