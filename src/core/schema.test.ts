import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkflowGraphSchema } from './schema'

test('WorkflowGraph validates without visualLayout', () => {
  const result = WorkflowGraphSchema.safeParse({
    nodes: [],
    edges: [],
  })
  assert.ok(result.success)
  if (result.success) {
    assert.equal(result.data.visualLayout, undefined)
  }
})

test('WorkflowGraph validates with empty visualLayout', () => {
  const result = WorkflowGraphSchema.safeParse({
    nodes: [],
    edges: [],
    visualLayout: { agents: {}, skills: {} },
  })
  assert.ok(result.success)
  if (result.success) {
    assert.deepEqual(result.data.visualLayout, { agents: {}, skills: {} })
  }
})

test('WorkflowGraph validates with agent positions in visualLayout', () => {
  const result = WorkflowGraphSchema.safeParse({
    nodes: [],
    edges: [],
    visualLayout: {
      agents: {
        'n1::developer': { x: 100, y: 200 },
        'n1::tester': { x: 300, y: 200 },
      },
      skills: {
        'n1::developer::python-expert': { x: 450, y: 180 },
      },
    },
  })
  assert.ok(result.success)
  if (result.success) {
    const layout = result.data.visualLayout
    assert.ok(layout)
    assert.deepEqual(layout.agents['n1::developer'], { x: 100, y: 200 })
    assert.deepEqual(layout.skills['n1::developer::python-expert'], { x: 450, y: 180 })
  }
})

test('WorkflowGraph rejects invalid position (missing x)', () => {
  const result = WorkflowGraphSchema.safeParse({
    nodes: [],
    edges: [],
    visualLayout: {
      agents: { 'n1::dev': { y: 100 } },
      skills: {},
    },
  })
  assert.equal(result.success, false)
})

test('WorkflowGraph visualLayout does not affect node/edge validation', () => {
  const result = WorkflowGraphSchema.safeParse({
    nodes: [
      {
        id: 'n1',
        title: 'Test node',
        type: 'ai',
        position: { x: 0, y: 0 },
        agents: ['developer'],
      },
    ],
    edges: [],
    visualLayout: {
      agents: { 'n1::developer': { x: 250, y: 100 } },
      skills: {},
    },
  })
  assert.ok(result.success)
  if (result.success) {
    assert.equal(result.data.nodes[0]?.id, 'n1')
  }
})
