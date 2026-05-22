import type { Workflow, WorkflowGraph, WorkflowNode } from './schema.js'

export interface NodeRunInput {
  /** The workflow node about to execute. */
  node: WorkflowNode
  /** Rendered system prompt (AI nodes only — already has {task} and {upstream_outputs} substituted). */
  prompt: string
  /** The original task that started this run. */
  task: string
  /** Concatenated summaries of all reached upstream nodes. */
  upstreamOutputs: string
  /** Working directory drones / scripts should operate in (e.g. a feature worktree). */
  cwd?: string
  /**
   * Direct downstream node ids in the graph. The AI markNodeComplete tool
   * uses this to validate the `next?: string[]` parameter — only adjacent
   * targets are accepted.
   */
  outgoingNodeIds: string[]
}

export interface NodeRunResult {
  summary: string
  outputs?: Record<string, string>
  /**
   * For AI nodes only: subset of `outgoingNodeIds` to follow. Undefined =
   * follow all (linear default). Custom nodes always follow all.
   */
  next?: string[]
}

export type NodeRunner = (input: NodeRunInput) => Promise<NodeRunResult>

export type RunEvent =
  | { type: 'run:started'; runId: string; task: string; nodeIds: string[] }
  | { type: 'node:started'; runId: string; nodeId: string; title: string }
  | { type: 'node:skipped'; runId: string; nodeId: string; title: string }
  | { type: 'node:complete'; runId: string; nodeId: string; title: string; summary: string; outputs?: Record<string, string> }
  | { type: 'run:complete'; runId: string; finalSummary: string }
  | { type: 'run:failed'; runId: string; nodeId?: string; error: string }

export interface RunOptions {
  runId: string
  task: string
  /** Working directory passed through to every node. */
  cwd?: string
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

/** Outgoing node ids (direct downstream) for a given node. */
export function outgoingOf(graph: WorkflowGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.from === nodeId).map((e) => e.to)
}

/** Incoming node ids (direct upstream) for a given node. */
export function incomingOf(graph: WorkflowGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.to === nodeId).map((e) => e.from)
}

/** Substitute `{task}` and `{upstream_outputs}` in a prompt template. */
export function renderPrompt(
  template: string,
  vars: { task: string; upstream_outputs: string },
): string {
  return template
    .replaceAll('{task}', vars.task)
    .replaceAll('{upstream_outputs}', vars.upstream_outputs)
}

/**
 * Execute a Workflow with per-run reachability:
 *  - Topo-sort all nodes.
 *  - Seed `reachable` with every root (no incoming edges).
 *  - Walk nodes in topo order. If a node isn't reachable, emit node:skipped
 *    and don't propagate. Otherwise run it.
 *  - After an AI node returns `next: [...]`, only those downstream ids
 *    join `reachable`. Custom nodes (and AI nodes that omit `next`) follow
 *    all outgoing edges.
 *  - Halts on first failure.
 */
export async function runWorkflow(workflow: Workflow, opts: RunOptions): Promise<void> {
  const order = topoSort(workflow.graph)
  const outputs = new Map<string, string>()

  // Roots = nodes with no incoming edges. All roots start reachable.
  const reachable = new Set<string>(
    order.filter((n) => incomingOf(workflow.graph, n.id).length === 0).map((n) => n.id),
  )

  opts.emit({
    type: 'run:started',
    runId: opts.runId,
    task: opts.task,
    nodeIds: order.map((n) => n.id),
  })

  let lastCompletedId: string | null = null

  for (const node of order) {
    if (opts.signal?.aborted) {
      opts.emit({ type: 'run:failed', runId: opts.runId, nodeId: node.id, error: 'aborted' })
      throw new Error('aborted')
    }

    if (!reachable.has(node.id)) {
      opts.emit({ type: 'node:skipped', runId: opts.runId, nodeId: node.id, title: node.title })
      continue
    }

    opts.emit({ type: 'node:started', runId: opts.runId, nodeId: node.id, title: node.title })

    const upstreamIds = incomingOf(workflow.graph, node.id).filter((id) => outputs.has(id))
    const upstreamText = upstreamIds
      .map((id) => `--- output of ${id} ---\n${outputs.get(id) ?? '(no output)'}`)
      .join('\n\n')

    const rendered = renderPrompt(node.prompt ?? '', {
      task: opts.task,
      upstream_outputs: upstreamText,
    })
    const outgoingIds = outgoingOf(workflow.graph, node.id)

    try {
      const result = await opts.runNode({
        node,
        prompt: rendered,
        task: opts.task,
        upstreamOutputs: upstreamText,
        cwd: opts.cwd,
        outgoingNodeIds: outgoingIds,
      })
      outputs.set(node.id, result.summary)
      lastCompletedId = node.id

      // Decide which downstream nodes become reachable.
      const chosen =
        node.type === 'ai' && result.next !== undefined
          ? result.next.filter((n) => outgoingIds.includes(n))
          : outgoingIds
      for (const n of chosen) reachable.add(n)

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

  opts.emit({
    type: 'run:complete',
    runId: opts.runId,
    finalSummary: lastCompletedId ? (outputs.get(lastCompletedId) ?? '') : '',
  })
}
