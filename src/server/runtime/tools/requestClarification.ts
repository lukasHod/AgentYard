import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { randomUUID } from 'node:crypto'

export interface ClarificationRequest {
  id: string
  question: string
}

export interface ClarificationGateway {
  /** Called by the tool when the agent invokes request_clarification. Resolves with the user's reply text. */
  request(req: ClarificationRequest): Promise<string>
}

/**
 * Create a `request_clarification` tool bound to a gateway. The gateway is
 * typically the Session that owns this agent — it surfaces the question to
 * the user (via WebSocket / notification) and resolves the promise when the
 * user replies. The tool then returns the reply as its tool_result, and the
 * agent continues its turn.
 */
export function createClarificationTool(gateway: ClarificationGateway) {
  return tool(
    'request_clarification',
    'Request a clarification from the user. The tool blocks until the user replies; the reply text becomes the tool result. Use this when you need information that only the user can provide before continuing.',
    {
      question: z
        .string()
        .min(1)
        .describe('The question to ask the user. Be specific and concise.'),
    },
    async (args) => {
      const id = randomUUID()
      const answer = await gateway.request({ id, question: args.question })
      return { content: [{ type: 'text', text: answer }] }
    },
  )
}
