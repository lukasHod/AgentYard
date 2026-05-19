import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import type { Session } from '../Session.js'

export interface AssignTaskDeps {
  /** Look up a drone by role label (e.g. "implementer") or session id. */
  resolveDrone: (target: string) => Session | undefined
  /** Roles available for the leader to delegate to — surfaced in tool description. */
  rosterDescription?: string
}

/**
 * `assign_task` tool — given to the leader. The leader names a drone (by
 * label like "implementer" or by id) and an instruction; the tool blocks
 * until the drone finishes its turn and returns the drone's response as
 * the tool result. Clarifications by the drone happen on its own chat
 * channel and resolve to the drone's reply on the drone side; the leader
 * only observes the final response text.
 */
export function createAssignTaskTool(deps: AssignTaskDeps) {
  const desc =
    'Delegate a task to a drone agent on your team. The tool blocks until the drone finishes and returns their response as the tool result.' +
    (deps.rosterDescription ? ` Available drones: ${deps.rosterDescription}` : '')

  return tool(
    'assign_task',
    desc,
    {
      drone: z
        .string()
        .min(1)
        .describe('Drone target — either the role label (e.g. "implementer") or the session id'),
      instruction: z
        .string()
        .min(1)
        .describe('Concrete, complete instruction to the drone — include all context they need'),
    },
    async (args) => {
      const target = deps.resolveDrone(args.drone)
      if (!target) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `No drone found for "${args.drone}". Use the exact label from your roster.`,
            },
          ],
        }
      }
      try {
        const response = await target.ask(args.instruction)
        return {
          content: [
            {
              type: 'text',
              text:
                response.trim().length > 0
                  ? response
                  : '(drone produced no text response)',
            },
          ],
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        return {
          isError: true,
          content: [{ type: 'text', text: `Drone error: ${text}` }],
        }
      }
    },
  )
}
