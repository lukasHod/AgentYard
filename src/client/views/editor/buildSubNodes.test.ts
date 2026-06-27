import { describe, it, expect } from 'vitest'
import { buildSubNodes, agentKey, skillKey } from './buildSubNodes'
import type { AgentTool } from '../../../core/tools'

function makeWfNode(id: string, x: number, y: number, agents: string[]) {
  return {
    id,
    position: { x, y },
    data: { node: { agents } },
  }
}

function makeAgent(name: string, skills: string[] = [], description = ''): AgentTool {
  return {
    name,
    description,
    role: 'test',
    toolPreset: 'claude_code',
    allowedTools: [],
    skills,
    mcps: [],
    scripts: [],
    prompt: '',
  }
}

describe('buildSubNodes', () => {
  it('returns empty arrays when no nodes have agents', () => {
    const result = buildSubNodes([makeWfNode('n1', 0, 0, [])], {}, undefined)
    expect(result.agentNodes).toHaveLength(0)
    expect(result.skillNodes).toHaveLength(0)
    expect(result.agentNodes).toHaveLength(0)
  })

  it('creates one agent node per assigned agent', () => {
    const wfNodes = [makeWfNode('n1', 100, 100, ['developer'])]
    const agentMap = { developer: makeAgent('developer') }

    const { agentNodes, skillNodes } = buildSubNodes(wfNodes, agentMap, undefined)

    expect(agentNodes).toHaveLength(1)
    const n = agentNodes[0]
    expect(n).toBeDefined()
    expect(n!.id).toBe(`agent::${agentKey('n1', 'developer')}`)
    expect(n!.type).toBe('agentSub')
    expect(n!.data.agentName).toBe('developer')
    expect(skillNodes).toHaveLength(0)
  })

  it('creates skill nodes for each agent skill', () => {
    const wfNodes = [makeWfNode('n1', 0, 0, ['developer'])]
    const agentMap = { developer: makeAgent('developer', ['skill-a', 'skill-b']) }

    const { skillNodes } = buildSubNodes(wfNodes, agentMap, undefined)

    expect(skillNodes).toHaveLength(2)
    expect(skillNodes[0]?.data.skillName).toBe('skill-a')
    expect(skillNodes[1]?.data.skillName).toBe('skill-b')
  })

  it('uses saved positions from visualLayout', () => {
    const wfNodes = [makeWfNode('n1', 0, 0, ['developer'])]
    const agentMap = { developer: makeAgent('developer') }
    const key = agentKey('n1', 'developer')
    const savedPos = { x: 999, y: 888 }

    const { agentNodes } = buildSubNodes(wfNodes, agentMap, {
      agents: { [key]: savedPos },
      skills: {},
    })

    expect(agentNodes[0]?.position).toEqual(savedPos)
  })

  it('auto-layouts agent positions when no saved position exists', () => {
    const wfNodes = [makeWfNode('n1', 100, 200, ['developer'])]
    const agentMap = { developer: makeAgent('developer') }

    const { agentNodes } = buildSubNodes(wfNodes, agentMap, undefined)

    // Single agent is centered on parent (x stays at parent x).
    // Y is always offset below the parent node.
    expect(agentNodes[0]?.position.x).toBe(100)
    expect(agentNodes[0]?.position.y).toBeGreaterThan(200)
  })

  it('handles multiple workflow nodes independently', () => {
    const wfNodes = [
      makeWfNode('n1', 0, 0, ['developer']),
      makeWfNode('n2', 500, 0, ['tester']),
    ]
    const agentMap = {
      developer: makeAgent('developer'),
      tester: makeAgent('tester'),
    }

    const { agentNodes } = buildSubNodes(wfNodes, agentMap, undefined)

    expect(agentNodes).toHaveLength(2)
    const ids = agentNodes.map((n) => n.id)
    expect(ids).toContain(`agent::${agentKey('n1', 'developer')}`)
    expect(ids).toContain(`agent::${agentKey('n2', 'tester')}`)
  })

  it('agentKey produces consistent format', () => {
    expect(agentKey('my-node', 'my-agent')).toBe('my-node::my-agent')
  })

  it('skillKey produces consistent format', () => {
    expect(skillKey('my-node', 'my-agent', 'my-skill')).toBe('my-node::my-agent::my-skill')
  })

  it('marks sub-nodes as draggable', () => {
    const wfNodes = [makeWfNode('n1', 0, 0, ['developer'])]
    const agentMap = { developer: makeAgent('developer', ['skill-x']) }

    const { agentNodes, skillNodes } = buildSubNodes(wfNodes, agentMap, undefined)

    expect(agentNodes[0]?.draggable).toBe(true)
    expect(skillNodes[0]?.draggable).toBe(true)
  })
})
