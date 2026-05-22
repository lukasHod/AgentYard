import { spawn } from 'node:child_process'
import type { NodeRunInput, NodeRunResult } from '../../core/executor.js'
import type { ScanContext } from '../tools/scanner.js'
import { resolveTool } from '../tools/resolver.js'
import { resolveEnvVars } from '../secrets.js'
import type { ScriptTool } from '../../core/tools.js'

const MAX_OUTPUT_CHARS = 32_000
const TIMEOUT_MS = 600_000 // 10 min for a script node — much longer than a per-tool call

/**
 * Execute a workflow node of type 'custom' with customType 'script'.
 * - Resolves node.scriptName via the tool library (ship → global)
 * - Substitutes {task} / {upstream_outputs} into the script's arg values
 * - Substitutes {argName} into the script's `cmd`
 * - Runs via the platform shell inside `input.cwd`
 * - Captures stdout (truncated) as the node's summary; non-zero exit → throws
 */
export async function runScriptNode(
  input: NodeRunInput,
  ctx: ScanContext,
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

  // Build the final cmd: env-var resolved, then {argName} substituted.
  let cmd = resolveEnvVars(script.cmd)
  for (const arg of script.args ?? []) {
    const v = renderedArgs[arg.name] ?? ''
    cmd = cmd.replaceAll(`{${arg.name}}`, v)
  }

  const result = await runShell(cmd, input.cwd, TIMEOUT_MS)
  const stdout = truncate(result.stdout, MAX_OUTPUT_CHARS)
  const stderr = truncate(result.stderr, MAX_OUTPUT_CHARS)

  if (result.code !== 0) {
    throw new Error(
      `script "${script.name}" exited with code ${result.code}\n` +
        (stderr ? `--- stderr ---\n${stderr}\n` : '') +
        (stdout ? `--- stdout ---\n${stdout}` : ''),
    )
  }

  const summary = stdout.trim() || (stderr ? `(stderr only)\n${stderr.trim()}` : '(no output)')
  return { summary, outputs: { stdout, stderr } }
}

interface ShellResult {
  code: number
  stdout: string
  stderr: string
}

function runShell(cmd: string, cwd: string | undefined, timeoutMs: number): Promise<ShellResult> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const child = isWin
      ? spawn('cmd.exe', ['/c', cmd], { cwd, windowsHide: true })
      : spawn('/bin/sh', ['-c', cmd], { cwd })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
      stderr += `\n[timeout after ${timeoutMs}ms]`
    }, timeoutMs)

    child.stdout?.on('data', (d) => (stdout += d.toString()))
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    child.on('error', (e) => {
      stderr += `\n[spawn error: ${e.message}]`
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr })
    })
  })
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + `\n…[truncated, ${s.length - max} more chars]`
}
