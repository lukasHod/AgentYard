import test from 'node:test'
import assert from 'node:assert/strict'
import {
  incomingOf,
  outgoingOf,
  renderPrompt,
  runWorkflow,
  topoSort,
  type NodeRunInput,
  type NodeRunResult,
  type RunEvent,
} from './executor.js'
import type { Workflow, WorkflowGraph, WorkflowNode } from './schema.js'

// ── helpers ──

function aiNode(id: string, opts: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type: 'ai',
    title: id,
    prompt: '',
    agents: [],
    position: { x: 0, y: 0 },
    ...opts,
  }
}

function workflow(
  nodes: WorkflowNode[],
  edges: { from: string; to: string }[],
): Workflow {
  return {
    id: 1,
    name: 'test',
    graph: { nodes, edges },
    isTemplate: false,
  }
}

interface CollectResult {
  events: RunEvent[]
  error: Error | null
}

async function collect(
  wf: Workflow,
  runNode: (input: NodeRunInput) => Promise<NodeRunResult>,
  signal?: AbortSignal,
): Promise<CollectResult> {
  const events: RunEvent[] = []
  try {
    await runWorkflow(wf, {
      runId: 'r1',
      task: 'mytask',
      runNode,
      emit: (ev) => events.push(ev),
      ...(signal ? { signal } : {}),
    })
    return { events, error: null }
  } catch (err) {
    return { events, error: err as Error }
  }
}

function nodeIdsWithType(events: RunEvent[], type: RunEvent['type']): string[] {
  return events
    .filter((e) => e.type === type)
    .map((e) => ('nodeId' in e ? e.nodeId : undefined))
    .filter((id): id is string => typeof id === 'string')
}

// ── topoSort ──

test('topoSort: linear chain', () => {
  const order = topoSort({
    nodes: [aiNode('a'), aiNode('b'), aiNode('c')],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ],
  })
  assert.deepEqual(
    order.map((n) => n.id),
    ['a', 'b', 'c'],
  )
})

test('topoSort: diamond yields a valid partial order', () => {
  const order = topoSort({
    nodes: [aiNode('a'), aiNode('b'), aiNode('c'), aiNode('d')],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'd' },
      { from: 'c', to: 'd' },
    ],
  })
  const idx = (id: string) => order.findIndex((n) => n.id === id)
  assert.ok(idx('a') < idx('b'))
  assert.ok(idx('a') < idx('c'))
  assert.ok(idx('b') < idx('d'))
  assert.ok(idx('c') < idx('d'))
})

test('topoSort: cycle throws', () => {
  assert.throws(
    () =>
      topoSort({
        nodes: [aiNode('a'), aiNode('b')],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      }),
    /cycle/,
  )
})

test('topoSort: roots are emitted before dependents even if they have no outgoing edges', () => {
  const order = topoSort({
    nodes: [aiNode('a'), aiNode('b'), aiNode('orphan')],
    edges: [{ from: 'a', to: 'b' }],
  })
  // orphan and a are both roots; only constraint is a before b.
  const idx = (id: string) => order.findIndex((n) => n.id === id)
  assert.ok(idx('a') < idx('b'))
  assert.ok(idx('orphan') >= 0)
})

// ── adjacency helpers ──

test('outgoingOf / incomingOf return direct neighbours', () => {
  const g: WorkflowGraph = {
    nodes: [aiNode('a'), aiNode('b'), aiNode('c')],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
    ],
  }
  assert.deepEqual(outgoingOf(g, 'a'), ['b', 'c'])
  assert.deepEqual(incomingOf(g, 'b'), ['a'])
  assert.deepEqual(incomingOf(g, 'a'), [])
  assert.deepEqual(outgoingOf(g, 'b'), [])
})

// ── renderPrompt ──

test('renderPrompt substitutes both tokens, all occurrences', () => {
  assert.equal(
    renderPrompt('task={task} again={task} up={upstream_outputs}', {
      task: 'T',
      upstream_outputs: 'U',
    }),
    'task=T again=T up=U',
  )
})

test('renderPrompt: missing token left literal', () => {
  assert.equal(
    renderPrompt('{unknown}', { task: 'T', upstream_outputs: 'U' }),
    '{unknown}',
  )
})

// ── runWorkflow: linear ──

test('runWorkflow: linear chain runs in order, upstream summaries flow', async () => {
  const seenUpstream: string[] = []
  const result = await collect(
    workflow(
      [aiNode('a'), aiNode('b'), aiNode('c')],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    ),
    async (input) => {
      seenUpstream.push(`${input.node.id}:${input.upstreamOutputs}`)
      return { summary: `done(${input.node.id})` }
    },
  )
  assert.equal(result.error, null)
  assert.deepEqual(seenUpstream, [
    'a:',
    'b:--- output of a ---\ndone(a)',
    'c:--- output of b ---\ndone(b)',
  ])
  const types = result.events.map((e) => e.type)
  assert.deepEqual(types, [
    'run:started',
    'node:started',
    'node:complete',
    'node:started',
    'node:complete',
    'node:started',
    'node:complete',
    'run:complete',
  ])
})

test("runWorkflow: AI node's `next` narrows reachability — siblings skip", async () => {
  const result = await collect(
    workflow(
      [aiNode('a'), aiNode('b'), aiNode('c')],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    ),
    async (input) => {
      if (input.node.id === 'a') return { summary: 'a-done', next: ['b'] }
      return { summary: `${input.node.id}-done` }
    },
  )
  assert.equal(result.error, null)
  assert.deepEqual(nodeIdsWithType(result.events, 'node:complete').sort(), ['a', 'b'])
  assert.deepEqual(nodeIdsWithType(result.events, 'node:skipped'), ['c'])
})

test('runWorkflow: AI `next` ids that are not adjacent are dropped silently', async () => {
  const result = await collect(
    workflow(
      [aiNode('a'), aiNode('b')],
      [{ from: 'a', to: 'b' }],
    ),
    async (input) => {
      if (input.node.id === 'a') return { summary: 'a', next: ['nonsense', 'b'] }
      return { summary: 'b' }
    },
  )
  assert.equal(result.error, null)
  // 'b' still runs because it IS adjacent; the bogus 'nonsense' is filtered out.
  assert.deepEqual(nodeIdsWithType(result.events, 'node:complete'), ['a', 'b'])
})

test('runWorkflow: empty `next` skips everything downstream', async () => {
  const result = await collect(
    workflow(
      [aiNode('a'), aiNode('b'), aiNode('c')],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    ),
    async (input) => {
      if (input.node.id === 'a') return { summary: 'a', next: [] }
      return { summary: input.node.id }
    },
  )
  assert.equal(result.error, null)
  assert.deepEqual(nodeIdsWithType(result.events, 'node:complete'), ['a'])
  assert.deepEqual(nodeIdsWithType(result.events, 'node:skipped').sort(), ['b', 'c'])
})

test('runWorkflow: failure emits run:failed with the failing nodeId and halts', async () => {
  const result = await collect(
    workflow(
      [aiNode('a'), aiNode('b'), aiNode('c')],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    ),
    async (input) => {
      if (input.node.id === 'b') throw new Error('boom')
      return { summary: `${input.node.id}-done` }
    },
  )
  assert.ok(result.error)
  assert.equal(result.error!.message, 'boom')
  const failed = result.events.find((e) => e.type === 'run:failed')
  assert.ok(failed && failed.type === 'run:failed')
  assert.equal(failed.nodeId, 'b')
  assert.equal(failed.error, 'boom')
  // c never even started
  assert.deepEqual(nodeIdsWithType(result.events, 'node:started'), ['a', 'b'])
})

test('runWorkflow: abort signal stops the run before the next node', async () => {
  const ctl = new AbortController()
  const result = await collect(
    workflow(
      [aiNode('a'), aiNode('b')],
      [{ from: 'a', to: 'b' }],
    ),
    async (input) => {
      if (input.node.id === 'a') ctl.abort()
      return { summary: 'done' }
    },
    ctl.signal,
  )
  assert.ok(result.error)
  assert.match(result.error!.message, /aborted/)
  assert.deepEqual(nodeIdsWithType(result.events, 'node:started'), ['a'])
})

test('runWorkflow: custom node always follows all outgoing edges (ignores `next`)', async () => {
  // Contract: only AI nodes can branch via `next`. Custom returning `next` is
  // a silent no-op — all downstream nodes still run.
  const customA: WorkflowNode = {
    id: 'a',
    type: 'custom',
    title: 'a',
    customType: 'script',
    scriptName: 's',
    position: { x: 0, y: 0 },
  }
  const result = await collect(
    workflow(
      [customA, aiNode('b'), aiNode('c')],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    ),
    async (input) => {
      if (input.node.id === 'a') return { summary: 'a-done', next: ['b'] } // ignored
      return { summary: `${input.node.id}-done` }
    },
  )
  assert.equal(result.error, null)
  assert.deepEqual(nodeIdsWithType(result.events, 'node:complete').sort(), ['a', 'b', 'c'])
})

test('runWorkflow: empty graph emits run:started + run:complete with empty finalSummary', async () => {
  const result = await collect(workflow([], []), async () => {
    throw new Error('should not run')
  })
  assert.equal(result.error, null)
  assert.deepEqual(
    result.events.map((e) => e.type),
    ['run:started', 'run:complete'],
  )
  const done = result.events.find((e) => e.type === 'run:complete')
  assert.ok(done && done.type === 'run:complete')
  assert.equal(done.finalSummary, '')
})

test('runWorkflow: run:complete carries the LAST completed node\'s summary', async () => {
  const result = await collect(
    workflow(
      [aiNode('a'), aiNode('b')],
      [{ from: 'a', to: 'b' }],
    ),
    async (input) => ({ summary: `${input.node.id}-output` }),
  )
  const done = result.events.find((e) => e.type === 'run:complete')
  assert.ok(done && done.type === 'run:complete')
  assert.equal(done.finalSummary, 'b-output')
})

test('runWorkflow: a skipped node\'s downstream skips too (skip propagates)', async () => {
  const result = await collect(
    workflow(
      [aiNode('a'), aiNode('b'), aiNode('c'), aiNode('d')],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'd' },
      ],
    ),
    async (input) => {
      if (input.node.id === 'a') return { summary: 'a', next: ['c'] } // skip b
      return { summary: input.node.id }
    },
  )
  assert.equal(result.error, null)
  // a → c completed. b skipped → d also skipped (no upstream reached it).
  assert.deepEqual(nodeIdsWithType(result.events, 'node:complete').sort(), ['a', 'c'])
  assert.deepEqual(nodeIdsWithType(result.events, 'node:skipped').sort(), ['b', 'd'])
})

test('runWorkflow: diamond with both branches reachable runs everything', async () => {
  // a → b → d
  //  \ → c ↗
  // Default reachability (no branching) — all four should run.
  const result = await collect(
    workflow(
      [aiNode('a'), aiNode('b'), aiNode('c'), aiNode('d')],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'd' },
        { from: 'c', to: 'd' },
      ],
    ),
    async (input) => ({ summary: input.node.id }),
  )
  assert.equal(result.error, null)
  assert.deepEqual(
    nodeIdsWithType(result.events, 'node:complete').sort(),
    ['a', 'b', 'c', 'd'],
  )
})

test('runWorkflow: upstream from multiple parents concatenated in topo order', async () => {
  // a, b are both roots feeding c. c sees both summaries.
  let cUpstream = ''
  const result = await collect(
    workflow(
      [aiNode('a'), aiNode('b'), aiNode('c')],
      [
        { from: 'a', to: 'c' },
        { from: 'b', to: 'c' },
      ],
    ),
    async (input) => {
      if (input.node.id === 'c') cUpstream = input.upstreamOutputs
      return { summary: `${input.node.id}!` }
    },
  )
  assert.equal(result.error, null)
  assert.match(cUpstream, /--- output of a ---\na!/)
  assert.match(cUpstream, /--- output of b ---\nb!/)
})
