import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'

export interface NodeCompleteOutputs {
  summary: string
  outputs?: Record<string, string>
  /**
   * Subset of the current node's outgoing edges to follow. Adjacency-validated
   * against the factory's `outgoingNodeIds`. Omitted = follow all (linear default).
   */
  next?: string[]
}

export interface MarkNodeCompleteDeps {
  /** Id of the workflow node this leader is running. Surfaced in the tool description. */
  nodeId: string
  /** Direct downstream node ids — `next` arg must be a subset of these. */
  outgoingNodeIds: string[]
  /** Callback the executor uses to receive the summary + outputs + next picks. */
  onComplete: (result: NodeCompleteOutputs) => void
}

/**
 * `mark_node_complete` — given to AI leaders. Signals that the current
 * workflow node is finished. Optionally narrows which downstream nodes
 * activate next via the `next` parameter (branching).
 */
export function createMarkNodeCompleteTool(deps: MarkNodeCompleteDeps) {
  const outgoingHint =
    deps.outgoingNodeIds.length === 0
      ? 'This node has no downstream nodes — `next` is ignored.'
      : deps.outgoingNodeIds.length === 1
        ? `This node has one downstream node (${deps.outgoingNodeIds[0]}); omitting \`next\` follows it.`
        : `This node has multiple downstream nodes: ${deps.outgoingNodeIds.join(', ')}. Pass \`next: ["<id>", ...]\` with the subset you want to activate; omit to activate all.`

  return tool(
    'mark_node_complete',
    `Signal that the current workflow node (${deps.nodeId}) is fully complete. Provide a summary of what was accomplished and any structured outputs downstream nodes will need. Call this exactly once when all drone tasks are done. ${outgoingHint}`,
    {
      summary: z
        .string()
        .min(1)
        .describe('Concise human-readable summary of what was accomplished'),
      outputs: z
        .record(z.string(), z.string())
        .optional()
        .describe('Structured outputs (key-value strings) for downstream nodes'),
      next: z
        .array(z.string())
        .optional()
        .describe(
          'Subset of this node\'s direct downstream node ids to follow next. Omit to follow all.',
        ),
    },
    async (args) => {
      if (args.next !== undefined) {
        const invalid = args.next.filter((n) => !deps.outgoingNodeIds.includes(n))
        if (invalid.length > 0) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `next contains non-adjacent target(s): ${invalid.join(', ')}. Valid targets: ${
                  deps.outgoingNodeIds.length > 0 ? deps.outgoingNodeIds.join(', ') : '(none)'
                }.`,
              },
            ],
          }
        }
      }
      deps.onComplete({ summary: args.summary, outputs: args.outputs, next: args.next })
      return {
        content: [
          { type: 'text', text: 'Node marked complete. Orchestrator advancing.' },
        ],
      }
    },
  )
}
