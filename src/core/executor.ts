import type { DroneSlot, Workflow, WorkflowGraph, WorkflowNode } from './schema.js'

export interface NodeRunInput {
  /** The workflow node about to execute. */
  node: WorkflowNode
  /** Rendered system prompt with template tokens substituted. */
  prompt: string
  /** Drone slot definitions for this node. */
  drones: DroneSlot[]
  /** Skills attached to this node. */
  skills: string[]
  /** The original task that started this run. */
  task: string
  /** Concatenated summaries of all upstream nodes (joined with blank lines). */
  upstreamOutputs: string
}

export interface NodeRunResult {
  summary: string
  outputs?: Record<string, string>
}

export type NodeRunner = (input: NodeRunInput) => Promise<NodeRunResult>

export type RunEvent =
  | { type: 'run:started'; runId: string; task: string; nodeIds: string[] }
  | { type: 'node:started'; runId: string; nodeId: string; title: string }
  | { type: 'node:complete'; runId: string; nodeId: string; title: string; summary: string; outputs?: Record<string, string> }
  | { type: 'run:complete'; runId: string; finalSummary: string }
  | { type: 'run:failed'; runId: string; nodeId?: string; error: string }

export interface RunOptions {
  runId: string
  task: string
  runNode: NodeRunner
  emit: (event: RunEvent) => void
  signal?: AbortSignal
}

/** Kahn's algorithm — throws on cycle. */
export function topoSort(graph: WorkflowGraph): WorkflowNode[] {
  const indegree = new Map<string, number>()
  const out = new Map<string, string[]>()
  for (const n of graph.nodes) {
    indegree.set(n.id, 0)
    out.set(n.id, [])
  }
  for (const e of graph.edges) {
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1)
    out.get(e.from)?.push(e.to)
  }
  const queue: string[] = []
  for (const [id, deg] of indegree) if (deg === 0) queue.push(id)
  const order: WorkflowNode[] = []
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  while (queue.length > 0) {
    const id = queue.shift()!
    const node = byId.get(id)
    if (!node) throw new Error(`Workflow graph references unknown node ${id}`)
    order.push(node)
    for (const next of out.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1
      indegree.set(next, d)
      if (d === 0) queue.push(next)
    }
  }
  if (order.length !== graph.nodes.length) {
    throw new Error('Workflow graph contains a cycle')
  }
  return order
}

/** Look up direct upstream nodes for a node id. */
function upstreamOf(graph: WorkflowGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.to === nodeId).map((e) => e.from)
}

/** Substitute `{task}` and `{upstream_outputs}` in a prompt template. */
export function renderPrompt(template: string, vars: { task: string; upstream_outputs: string }): string {
  return template
    .replaceAll('{task}', vars.task)
    .replaceAll('{upstream_outputs}', vars.upstream_outputs)
}

/**
 * Execute a Workflow sequentially. Each node receives the concatenated
 * summaries of its upstream nodes as `{upstream_outputs}`. Halts on the
 * first failure. Parallel nodes are still serialized in this Phase 3
 * implementation; concurrent execution comes later.
 */
export async function runWorkflow(workflow: Workflow, opts: RunOptions): Promise<void> {
  const order = topoSort(workflow.graph)
  const outputs = new Map<string, string>()

  opts.emit({
    type: 'run:started',
    runId: opts.runId,
    task: opts.task,
    nodeIds: order.map((n) => n.id),
  })

  for (const node of order) {
    if (opts.signal?.aborted) {
      opts.emit({ type: 'run:failed', runId: opts.runId, nodeId: node.id, error: 'aborted' })
      throw new Error('aborted')
    }

    opts.emit({ type: 'node:started', runId: opts.runId, nodeId: node.id, title: node.title })

    const upstreamIds = upstreamOf(workflow.graph, node.id)
    const upstreamText = upstreamIds
      .map((id) => `--- output of ${id} ---\n${outputs.get(id) ?? '(no output)'}`)
      .join('\n\n')

    const rendered = renderPrompt(node.prompt, { task: opts.task, upstream_outputs: upstreamText })

    try {
      const result = await opts.runNode({
        node,
        prompt: rendered,
        drones: node.drones,
        skills: node.skills,
        task: opts.task,
        upstreamOutputs: upstreamText,
      })
      outputs.set(node.id, result.summary)
      opts.emit({
        type: 'node:complete',
        runId: opts.runId,
        nodeId: node.id,
        title: node.title,
        summary: result.summary,
        outputs: result.outputs,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      opts.emit({ type: 'run:failed', runId: opts.runId, nodeId: node.id, error: msg })
      throw err
    }
  }

  const last = order[order.length - 1]!
  opts.emit({
    type: 'run:complete',
    runId: opts.runId,
    finalSummary: outputs.get(last.id) ?? '',
  })
}
