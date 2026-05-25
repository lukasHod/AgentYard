import type { NodeRunInput, NodeRunResult } from '../../core/executor.js'
import type { ScanContext } from '../tools/scanner.js'
import { resolveTool } from '../tools/resolver.js'
import type { ScriptTool } from '../../core/tools.js'
import { buildScriptArgv, runProcess } from './scriptArgv.js'

const MAX_OUTPUT_CHARS = 32_000
const TIMEOUT_MS = 600_000 // 10 min for a script node — much longer than a per-tool call

/**
 * Execute a workflow node of type 'custom' with customType 'script'.
 * - Resolves node.scriptName via the tool library (ship → global)
 * - Substitutes {task} / {upstream_outputs} into the script's arg values
 * - Tokenizes script.cmd by whitespace and per-token substitutes {argName} +
 *   `${env:VAR}` (see buildScriptArgv — no shell is invoked)
 * - Spawns the resulting argv inside `input.cwd`
 * - Captures stdout (truncated) as the node's summary; non-zero exit → throws
 */
export async function runScriptNode(
  input: NodeRunInput,
  ctx: ScanContext,
  signal?: AbortSignal,
): Promise<NodeRunResult> {
  const node = input.node
  if (node.type !== 'custom' || node.customType !== 'script') {
    throw new Error(`runScriptNode: expected custom/script node, got ${node.type}/${node.customType}`)
  }
  if (!node.scriptName) {
    throw new Error(`runScriptNode: node ${node.id} has no scriptName`)
  }
  const resolved = resolveTool('script', node.scriptName, ctx)
  if (!resolved || resolved.type !== 'script') {
    throw new Error(`runScriptNode: script "${node.scriptName}" not found in ship or global library`)
  }
  const script: ScriptTool = resolved.data

  // Render arg values with {task}/{upstream_outputs} substitution.
  const renderedArgs: Record<string, string> = {}
  for (const [k, v] of Object.entries(node.args ?? {})) {
    renderedArgs[k] = v.replaceAll('{task}', input.task).replaceAll(
      '{upstream_outputs}',
      input.upstreamOutputs,
    )
  }

  const { program, args } = buildScriptArgv(script, renderedArgs)
  const result = await runProcess(program, args, {
    cwd: input.cwd,
    timeoutMs: TIMEOUT_MS,
    maxOutputChars: MAX_OUTPUT_CHARS,
    signal,
  })

  if (result.code !== 0) {
    throw new Error(
      `script "${script.name}" exited with code ${result.code}\n` +
        (result.stderr ? `--- stderr ---\n${result.stderr}\n` : '') +
        (result.stdout ? `--- stdout ---\n${result.stdout}` : ''),
    )
  }

  const summary =
    result.stdout.trim() ||
    (result.stderr ? `(stderr only)\n${result.stderr.trim()}` : '(no output)')
  return { summary, outputs: { stdout: result.stdout, stderr: result.stderr } }
}
