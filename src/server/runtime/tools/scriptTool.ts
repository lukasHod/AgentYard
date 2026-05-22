import { spawn } from 'node:child_process'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import type { ScriptTool } from '../../../core/tools.js'
import { resolveEnvVars } from '../../secrets.js'

interface CreateScriptToolDeps {
  /** Script definition from the tool library. */
  script: ScriptTool
  /** Worktree (or other) directory the script runs in. */
  cwd: string | undefined
  /** Cap on captured stdout/stderr per call (chars). */
  maxOutputChars?: number
  /** Timeout per call (ms). */
  timeoutMs?: number
}

/**
 * Wrap a ScriptTool from the library as an MCP-style custom tool the agent
 * can call. The tool name becomes `mcp__ay_scripts__<script.name>` once
 * registered under the ay_scripts namespace.
 *
 * Substitution at call time:
 *   1. {argName} in `cmd` is replaced by the value the agent passed for that arg
 *      (substituted recursively through `${env:VAR}` if any).
 *   2. The resulting command runs via the system shell inside `cwd`.
 */
export function createScriptTool(deps: CreateScriptToolDeps) {
  const { script } = deps
  const maxChars = deps.maxOutputChars ?? 32_000
  const timeoutMs = deps.timeoutMs ?? 120_000

  // Build a Zod schema from the declared args. Required args are .string();
  // optional ones are .optional().
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const arg of script.args ?? []) {
    const desc = arg.description ? arg.description : `arg ${arg.name}`
    shape[arg.name] = arg.required ? z.string().describe(desc) : z.string().optional().describe(desc)
  }

  return tool(
    script.name,
    script.description?.length ? script.description : `Run the ${script.name} script.`,
    shape,
    async (args) => {
      // Resolve env vars in cmd (lets users put `${env:GITHUB_TOKEN}` in the
      // manifest itself if they want).
      let cmd = resolveEnvVars(script.cmd)
      // Substitute {argName} with the caller's args.
      for (const arg of script.args ?? []) {
        const v = (args as Record<string, string | undefined>)[arg.name]
        cmd = cmd.replaceAll(`{${arg.name}}`, v ?? '')
      }

      const result = await runShell(cmd, deps.cwd, { timeoutMs })
      const stdout = truncate(result.stdout, maxChars)
      const stderr = truncate(result.stderr, maxChars)

      if (result.code !== 0) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                `Script "${script.name}" exited with code ${result.code}\n` +
                (stderr ? `--- stderr ---\n${stderr}\n` : '') +
                (stdout ? `--- stdout ---\n${stdout}` : ''),
            },
          ],
        }
      }

      const out = stdout || (stderr ? `(stderr only)\n${stderr}` : '(no output)')
      return { content: [{ type: 'text', text: out }] }
    },
  )
}

interface ShellResult {
  code: number
  stdout: string
  stderr: string
}

function runShell(
  cmd: string,
  cwd: string | undefined,
  opts: { timeoutMs: number },
): Promise<ShellResult> {
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
      stderr += `\n[timeout after ${opts.timeoutMs}ms]`
    }, opts.timeoutMs)

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
