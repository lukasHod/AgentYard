import type { Node as RFNode } from '@xyflow/react'
import type { WorkflowGraph } from '../../../core/schema'
import type { AgentTool } from '../../../core/tools'
import type { AgentSubNodeData } from './AgentSubNode'
import type { SkillSubNodeData } from './SkillSubNode'

export type SubNodesResult = {
  agentNodes: RFNode<AgentSubNodeData>[]
  skillNodes: RFNode<SkillSubNodeData>[]
}

// Place agents below the workflow node, spread horizontally
const AGENT_OFFSET_Y = 100
const AGENT_SPREAD_X = 160
const SKILL_OFFSET_Y = 80
const SKILL_SPREAD_X = 130

/** Build an ID key for agent position storage. */
export function agentKey(workflowNodeId: string, agentName: string): string {
  return `${workflowNodeId}::${agentName}`
}

/** Build an ID key for skill position storage. */
export function skillKey(workflowNodeId: string, agentName: string, skillName: string): string {
  return `${workflowNodeId}::${agentName}::${skillName}`
}

/**
 * Synthesize agent and skill sub-nodes for the React Flow canvas.
 * Edges are NOT computed here — they are derived dynamically in EditorView
 * based on live node positions so handle direction flips when nodes are moved.
 */
export function buildSubNodes(
  workflowNodes: Array<{ id: string; position: { x: number; y: number }; data: { node: { agents?: string[] } } }>,
  agentDetailMap: Record<string, AgentTool>,
  visualLayout: WorkflowGraph['visualLayout'],
): SubNodesResult {
  const agentNodes: RFNode<AgentSubNodeData>[] = []
  const skillNodes: RFNode<SkillSubNodeData>[] = []

  for (const rfNode of workflowNodes) {
    const wfNode = rfNode.data.node
    const agents = wfNode.agents ?? []
    if (agents.length === 0) continue

    agents.forEach((agentName, agentIdx) => {
      const key = agentKey(rfNode.id, agentName)
      const agentNodeId = `agent::${key}`

      const savedPos = visualLayout?.agents?.[key]
      const totalWidth = (agents.length - 1) * AGENT_SPREAD_X
      const position = savedPos ?? {
        x: rfNode.position.x + agentIdx * AGENT_SPREAD_X - totalWidth / 2,
        y: rfNode.position.y + AGENT_OFFSET_Y,
      }

      const agentDetail = agentDetailMap[agentName]

      agentNodes.push({
        id: agentNodeId,
        type: 'agentSub',
        position,
        data: { agentName, description: agentDetail?.description, workflowNodeId: rfNode.id },
        draggable: true,
      })

      const skills = agentDetail?.skills ?? []
      skills.forEach((skillName, skillIdx) => {
        const sk = skillKey(rfNode.id, agentName, skillName)
        const skillNodeId = `skill::${sk}`
        const savedSkillPos = visualLayout?.skills?.[sk]
        const totalSkillWidth = (skills.length - 1) * SKILL_SPREAD_X
        const skillPosition = savedSkillPos ?? {
          x: position.x + skillIdx * SKILL_SPREAD_X - totalSkillWidth / 2,
          y: position.y + SKILL_OFFSET_Y,
        }
        skillNodes.push({
          id: skillNodeId,
          type: 'skillSub',
          position: skillPosition,
          data: { skillName },
          draggable: true,
        })
      })
    })
  }

  return { agentNodes, skillNodes }
}
