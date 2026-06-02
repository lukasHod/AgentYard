/**
 * Phase C smoke — script node runtime end-to-end (no real agents).
 *
 * Stages a global script in a temp HOME, then runs a workflow:
 *   ai-start (stub) → custom/script (real) → ai-end (stub)
 * Verifies:
 *   1. The script node's stdout is captured into NodeRunResult.summary.
 *   2. {task} / {upstream_outputs} template tokens substitute in the args.
 *   3. The downstream AI node receives the script's output via upstreamOutputs.
 *
 * Run with: npx tsx scripts/smoke-script-node.ts
 * (No server needed.)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  runWorkflow,
  type NodeRunInput,
  type NodeRunResult,
} from '../src/core/executor.js'
import { WorkflowGraphSchema, WorkflowSchema, type Workflow } from '../src/core/schema.js'
import { runScriptNode } from '../src/server/runtime/scriptRuntime.js'
import type { ScanContext } from '../src/server/tools/scanner.js'

const originalHome = process.env.HOME
const originalUserprofile = process.env.USERPROFILE

// Stage a fake $HOME so the resolver finds our seed script and nothing else.
const fakeHome = mkdtempSync(path.join(tmpdir(), 'agentyard-smoke-C-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
const scriptsDir = path.join(fakeHome, '.agentyard', 'scripts')
const scriptDir = path.join(scriptsDir, 'echo-task')
mkdirSync(scriptDir, { recursive: true })

writeFileSync(
  path.join(scriptDir, 'manifest.yaml'),
  yaml.dump(
    {
      name: 'echo-task',
      description: 'Smoke script — echoes a single argument.',
      cmd: 'echo SMOKE:{label}',
      args: [{ name: 'label', description: 'text to echo', required: true }],
    },
    { lineWidth: 0 },
  ),
  'utf8',
)

function restoreEnv() {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalUserprofile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = originalUserprofile
}

function cleanup() {
  restoreEnv()
  try {
    rmSync(fakeHome, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

interface CaseResult {
  name: string
  pass: boolean
  detail?: string
}

function makeWorkflow(): Workflow {
  const graph = WorkflowGraphSchema.parse({
    nodes: [
      {
        id: 'ai-start',
        title: 'Stubbed AI seed',
        type: 'ai',
        position: { x: 0, y: 0 },
        prompt: 'noop',
        agents: ['planner'],
      },
      {
        id: 'script',
        title: 'Script node',
        type: 'custom',
        customType: 'script',
        scriptName: 'echo-task',
        args: { label: '{task}/{upstream_outputs}' },
        position: { x: 200, y: 0 },
      },
      {
        id: 'ai-end',
        title: 'Stubbed AI sink',
        type: 'ai',
        position: { x: 400, y: 0 },
        prompt: 'noop',
        agents: ['planner'],
      },
    ],
    edges: [
      { from: 'ai-start', to: 'script' },
      { from: 'script', to: 'ai-end' },
    ],
  })
  return WorkflowSchema.parse({ id: 1, name: 'smoke-C', graph, isTemplate: false })
}

const ctx: ScanContext = { planetProjectPath: null }
const results: CaseResult[] = []
const capturedUpstream = new Map<string, string>()
let scriptSummary = ''

try {
  const wf = makeWorkflow()
  await runWorkflow(wf, {
    runId: 'smoke-C',
    task: 'TASK_HELLO',
    emit: () => {},
    runNode: async (input: NodeRunInput): Promise<NodeRunResult> => {
      if (input.node.type === 'custom') {
        const result = await runScriptNode(input, ctx)
        scriptSummary = result.summary
        return result
      }
      // Stub AI nodes — capture their incoming upstreamOutputs and return a marker.
      capturedUpstream.set(input.node.id, input.upstreamOutputs)
      return { summary: `${input.node.id} OK` }
    },
  })

  // 1. Script stdout captured.
  const startMarkerOk = scriptSummary.startsWith('SMOKE:')
  results.push({
    name: 'script stdout captured into summary',
    pass: startMarkerOk,
    detail: startMarkerOk ? undefined : `summary=${JSON.stringify(scriptSummary)}`,
  })

  // 2. {task} substituted.
  const taskSubOk = scriptSummary.includes('TASK_HELLO')
  results.push({
    name: '{task} substituted in script args',
    pass: taskSubOk,
    detail: taskSubOk ? undefined : `summary=${JSON.stringify(scriptSummary)}`,
  })

  // 3. {upstream_outputs} substituted into the args (we check for the executor's
  //    upstreamText header — full multi-line content can't reliably survive
  //    `cmd /c echo` on Windows, but the substitution itself is verifiable).
  const upstreamSubOk = scriptSummary.includes('--- output of ai-start ---')
  results.push({
    name: '{upstream_outputs} substituted in script args',
    pass: upstreamSubOk,
    detail: upstreamSubOk ? undefined : `summary=${JSON.stringify(scriptSummary)}`,
  })

  // 4. Downstream AI node sees the script's summary in upstreamOutputs.
  const aiEndUpstream = capturedUpstream.get('ai-end') ?? ''
  const flowedDownstream = aiEndUpstream.includes('SMOKE:')
  results.push({
    name: 'script output flows to downstream AI node via upstreamOutputs',
    pass: flowedDownstream,
    detail: flowedDownstream
      ? undefined
      : `ai-end upstreamOutputs=${JSON.stringify(aiEndUpstream)}`,
  })
} finally {
  cleanup()
}

let allPass = true
for (const r of results) {
  if (r.pass) console.log(`[smoke-C] PASS  ${r.name}`)
  else {
    console.log(`[smoke-C] FAIL  ${r.name}\n        ${r.detail}`)
    allPass = false
  }
}

process.exit(allPass ? 0 : 1)
