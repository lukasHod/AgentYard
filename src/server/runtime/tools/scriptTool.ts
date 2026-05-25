import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import type { ScriptTool } from '../../../core/tools.js'
import { buildScriptArgv, runProcess } from '../scriptArgv.js'

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
 * Substitution at call time (see scriptArgv.buildScriptArgv): script.cmd is
 * tokenized by whitespace; each token gets `${env:VAR}` and `{argName}`
 * substitution. The resulting argv is spawned WITHOUT a shell — agent-supplied
 * values stay confined to their argv slot regardless of contents.
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
      // Coerce undefined args to empty strings so substitution stays predictable.
      const values: Record<string, string> = {}
      for (const arg of script.args ?? []) {
        const v = (args as Record<string, string | undefined>)[arg.name]
        values[arg.name] = v ?? ''
      }

      let program: string
      let argv: string[]
      try {
        const parsed = buildScriptArgv(script, values)
        program = parsed.program
        argv = parsed.args
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Invalid script "${script.name}": ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
        }
      }

      const result = await runProcess(program, argv, {
        cwd: deps.cwd,
        timeoutMs,
        maxOutputChars: maxChars,
      })

      if (result.code !== 0) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                `Script "${script.name}" exited with code ${result.code}\n` +
                (result.stderr ? `--- stderr ---\n${result.stderr}\n` : '') +
                (result.stdout ? `--- stdout ---\n${result.stdout}` : ''),
            },
          ],
        }
      }

      const out =
        result.stdout || (result.stderr ? `(stderr only)\n${result.stderr}` : '(no output)')
      return { content: [{ type: 'text', text: out }] }
    },
  )
}
