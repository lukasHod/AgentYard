import { spawn } from 'node:child_process'
import type { ScriptTool } from '../../core/tools.js'
import { resolveEnvVars } from '../secrets.js'

/**
 * Build (program, argv) from a ScriptTool's `cmd` template and the caller's
 * arg values. The cmd string is tokenized by whitespace ONCE, then each token
 * gets `${env:VAR}` and `{argName}` substitution applied. A substituted value
 * containing spaces or shell metacharacters stays inside its own argv slot —
 * the process is spawned WITHOUT a shell, so no further interpretation occurs.
 *
 * This is the security boundary: agent-supplied arg values and workflow
 * `{task}` / `{upstream_outputs}` substitution can never escape into command
 * position or become extra argv elements.
 *
 * If a script needs shell features (pipes, globs, redirects), ship a body
 * file alongside manifest.yaml and reference it explicitly:
 *   cmd: "bash script.sh {filter}"
 */
export function buildScriptArgv(
  script: ScriptTool,
  values: Record<string, string>,
): { program: string; args: string[] } {
  const tokens = script.cmd.trim().split(/\s+/).filter((t) => t.length > 0)
  if (tokens.length === 0) {
    throw new Error(`script "${script.name}" has an empty cmd`)
  }
  const substituted = tokens.map((tok) => substituteToken(tok, script, values))
  return { program: substituted[0]!, args: substituted.slice(1) }
}

function substituteToken(
  token: string,
  script: ScriptTool,
  values: Record<string, string>,
): string {
  let s = resolveEnvVars(token)
  for (const arg of script.args ?? []) {
    const v = values[arg.name] ?? ''
    s = s.replaceAll(`{${arg.name}}`, v)
  }
  return s
}

export interface ProcessResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunProcessOpts {
  cwd?: string
  timeoutMs: number
  /** Per-stream cap. Once exceeded the child is killed. */
  maxOutputChars?: number
}

const DEFAULT_MAX_OUTPUT_CHARS = 32_000

/**
 * Run a child process WITHOUT a shell. Caps stdout/stderr accumulation per
 * stream and kills the child if the cap is exceeded — addresses the unbounded
 * buffering issue the old runShell had. Always resolves; spawn errors and
 * timeouts surface in `stderr` + a sentinel `code`.
 */
export function runProcess(
  program: string,
  args: string[],
  opts: RunProcessOpts,
): Promise<ProcessResult> {
  const maxChars = opts.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(program, args, { cwd: opts.cwd, windowsHide: true, shell: false })
    } catch (e) {
      resolve({
        code: 127,
        stdout: '',
        stderr: `[spawn error: ${e instanceof Error ? e.message : String(e)}]`,
        timedOut: false,
      })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let killedForOverflow = false

    const killChild = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore — already exited
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      killChild()
    }, opts.timeoutMs)

    const append = (which: 'stdout' | 'stderr', chunk: Buffer) => {
      const next = chunk.toString('utf8')
      const cur = which === 'stdout' ? stdout : stderr
      const remaining = maxChars - cur.length
      if (remaining <= 0) {
        if (!killedForOverflow) {
          killedForOverflow = true
          killChild()
        }
        return
      }
      const slice = next.length > remaining ? next.slice(0, remaining) : next
      if (which === 'stdout') stdout = cur + slice
      else stderr = cur + slice
      if (next.length > remaining && !killedForOverflow) {
        killedForOverflow = true
        killChild()
      }
    }

    child.stdout?.on('data', (d: Buffer) => append('stdout', d))
    child.stderr?.on('data', (d: Buffer) => append('stderr', d))
    child.on('error', (e) => {
      stderr += `\n[spawn error: ${e.message}]`
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        stderr += `\n[timeout after ${opts.timeoutMs}ms]`
      } else if (killedForOverflow) {
        stderr += `\n[output exceeded ${maxChars} chars per stream — process killed]`
      }
      resolve({
        code:
          typeof code === 'number'
            ? code
            : timedOut
              ? 124
              : killedForOverflow
                ? 137
                : 1,
        stdout,
        stderr,
        timedOut,
      })
    })
  })
}
