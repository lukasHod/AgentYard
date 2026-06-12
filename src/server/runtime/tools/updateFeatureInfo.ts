import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { updateFeature } from '../../features.js'
import type { TypedIOServer } from '../../socketTypes.js'

export function createUpdateFeatureInfoTool(deps: {
  featureId: number
  io: TypedIOServer
}): SdkMcpToolDefinition<any> {
  return tool(
    'update_feature_info',
    'Update the display name and description for this feature',
    {
      chatName: z.string().describe('Human-readable title, e.g. "Dashboard Readability Redesign"'),
      name: z.string().describe('Slug for git branch, e.g. "dashboard-redesign"'),
      description: z.string().describe('1-3 sentence summary of what this feature is about'),
    },
    async (args) => {
      const updated = updateFeature(deps.featureId, {
        chatName: args.chatName,
        name: args.name,
        description: args.description,
      })
      if (!updated) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Feature ${deps.featureId} not found — could not update info.`,
            },
          ],
        }
      }
      deps.io.emit('feature:updated', updated)
      return {
        content: [
          {
            type: 'text',
            text: `Feature info updated: '${args.chatName}'`,
          },
        ],
      }
    },
  )
}
