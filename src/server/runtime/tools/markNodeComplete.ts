import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'

export interface NodeCompleteOutputs {
  summary: string
  // Free-form structured outputs the leader chose to surface. Downstream
  // nodes receive this as their `inputs` payload.
  outputs?: Record<string, string>
}

/**
 * `mark_node_complete` — given to the leader. Signals that the current
 * workflow node is finished. The orchestrator records the outputs and
 * advances to the next node in the workflow graph.
 */
export function createMarkNodeCompleteTool(
  onComplete: (result: NodeCompleteOutputs) => void,
) {
  return tool(
    'mark_node_complete',
    'Signal that the current workflow node is fully complete. Provide a summary of what was accomplished and any structured outputs downstream nodes will need. Call this exactly once when all drone tasks are done.',
    {
      summary: z
        .string()
        .min(1)
        .describe('Concise human-readable summary of what was accomplished'),
      outputs: z
        .record(z.string(), z.string())
        .optional()
        .describe('Structured outputs (key-value strings) for downstream nodes'),
    },
    async (args) => {
      onComplete({ summary: args.summary, outputs: args.outputs })
      return {
        content: [
          { type: 'text', text: 'Node marked complete. Orchestrator advancing.' },
        ],
      }
    },
  )
}
