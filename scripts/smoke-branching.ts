/**
 * Phase B.3 smoke test — branching workflow + per-run reachability.
 *
 * Verifies the core executor (no real agents). Three scenarios:
 *   1. Linear chain runs every node when no `next` is provided.
 *   2. Branch: A → {B, C}, A returns next=['B']. B runs, C is skipped.
 *   3. Diamond: A → {B, C}, B → D, C → D. A chooses [B]; B reaches D.
 *      D runs (because B is on the reached path), C is skipped.
 *
 * Run with: npx tsx scripts/smoke-branching.ts
 * (No server needed — pure executor harness.)
 */
import { runWorkflow, type NodeRunInput, type NodeRunResult } from '../src/core/executor.js'
import { type Workflow, WorkflowGraphSchema, WorkflowSchema } from '../src/core/schema.js'

interface CaseResult {
  name: string
  pass: boolean
  detail?: string
}

function makeWorkflow(
  name: string,
  nodes: { id: string; agents?: string[] }[],
  edges: [string, string][],
): Workflow {
  const graph = WorkflowGraphSchema.parse({
    nodes: nodes.map((n) => ({
      id: n.id,
      title: n.id,
      type: 'ai' as const,
      position: { x: 0, y: 0 },
      prompt: 'noop',
      agents: n.agents ?? ['planner'],
    })),
    edges: edges.map(([from, to]) => ({ from, to })),
  })
  return WorkflowSchema.parse({ id: 1, name, graph, isTemplate: false })
}

async function runCase(
  caseName: string,
  workflow: Workflow,
  // For each node id, decide what NodeRunResult it returns.
  decide: (input: NodeRunInput) => NodeRunResult,
  expected: { started: string[]; skipped: string[] },
): Promise<CaseResult> {
  const started: string[] = []
  const skipped: string[] = []
  let failed: string | null = null
  await runWorkflow(workflow, {
    runId: 'smoke',
    task: 'smoke',
    emit: (ev) => {
      if (ev.type === 'node:started') started.push(ev.nodeId)
      if (ev.type === 'node:skipped') skipped.push(ev.nodeId)
      if (ev.type === 'run:failed') failed = ev.error
    },
    runNode: async (input) => decide(input),
  }).catch((e) => {
    failed = e instanceof Error ? e.message : String(e)
  })

  if (failed) {
    return { name: caseName, pass: false, detail: `run failed: ${failed}` }
  }

  const startedSorted = [...started].sort()
  const skippedSorted = [...skipped].sort()
  const expectedStartedSorted = [...expected.started].sort()
  const expectedSkippedSorted = [...expected.skipped].sort()

  const ok =
    JSON.stringify(startedSorted) === JSON.stringify(expectedStartedSorted) &&
    JSON.stringify(skippedSorted) === JSON.stringify(expectedSkippedSorted)

  if (!ok) {
    return {
      name: caseName,
      pass: false,
      detail:
        `started=${JSON.stringify(startedSorted)} ` +
        `expected.started=${JSON.stringify(expectedStartedSorted)} ` +
        `skipped=${JSON.stringify(skippedSorted)} ` +
        `expected.skipped=${JSON.stringify(expectedSkippedSorted)}`,
    }
  }
  return { name: caseName, pass: true }
}

const results: CaseResult[] = []

// Case 1 — linear chain, no `next`, every node runs.
{
  const wf = makeWorkflow(
    'linear',
    [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    [
      ['A', 'B'],
      ['B', 'C'],
    ],
  )
  results.push(
    await runCase(
      'linear: no next → all nodes run',
      wf,
      () => ({ summary: 'ok' }),
      { started: ['A', 'B', 'C'], skipped: [] },
    ),
  )
}

// Case 2 — branch, A picks B, C is skipped.
{
  const wf = makeWorkflow(
    'branch',
    [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    [
      ['A', 'B'],
      ['A', 'C'],
    ],
  )
  results.push(
    await runCase(
      'branch: A returns next=[B] → C skipped',
      wf,
      (input) => {
        if (input.node.id === 'A') return { summary: 'pick B', next: ['B'] }
        return { summary: 'ok' }
      },
      { started: ['A', 'B'], skipped: ['C'] },
    ),
  )
}

// Case 3 — diamond, A chooses B; D still reachable via B; C skipped.
{
  const wf = makeWorkflow(
    'diamond',
    [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
    [
      ['A', 'B'],
      ['A', 'C'],
      ['B', 'D'],
      ['C', 'D'],
    ],
  )
  results.push(
    await runCase(
      'diamond: A→B (skip C) → D still runs via B',
      wf,
      (input) => {
        if (input.node.id === 'A') return { summary: 'pick B', next: ['B'] }
        return { summary: 'ok' }
      },
      { started: ['A', 'B', 'D'], skipped: ['C'] },
    ),
  )
}

// Case 4 — adjacency guard: mark_node_complete shouldn't accept a non-adjacent id.
// We test this via the tool itself, since the executor only filters; the
// markNodeComplete tool also validates and errors at agent-tool boundary.
{
  const { createMarkNodeCompleteTool } = await import(
    '../src/server/runtime/tools/markNodeComplete.js'
  )
  const tool = createMarkNodeCompleteTool({
    nodeId: 'A',
    outgoingNodeIds: ['B', 'C'],
    onComplete: () => {},
  })
  const out = (await (tool as { handler: (args: unknown) => Promise<unknown> }).handler({
    summary: 'noop',
    next: ['ZZZ'], // not adjacent
  })) as { isError?: boolean; content?: Array<{ text?: string }> }
  const errored = out?.isError === true
  results.push({
    name: 'mark_node_complete rejects non-adjacent next',
    pass: errored,
    detail: errored ? undefined : `got non-error result: ${JSON.stringify(out)}`,
  })
}

let allPass = true
for (const r of results) {
  if (r.pass) console.log(`[smoke-B] PASS  ${r.name}`)
  else {
    console.log(`[smoke-B] FAIL  ${r.name}\n        ${r.detail}`)
    allPass = false
  }
}

process.exit(allPass ? 0 : 1)
