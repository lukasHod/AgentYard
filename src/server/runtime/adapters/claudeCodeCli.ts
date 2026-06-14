import type {
  AgentCapabilities,
  AgentEvent,
  AgentStartConfig,
} from '../../../core/plugins.js'
import { PtyAgentBase, type PtyLaunchPlan } from './ptyAgentBase.js'

/**
 * Adapter for the Claude Code CLI (`claude`), running under a PTY.
 *
 * Phase 5 scope: launch the CLI interactively in the requested cwd, push
 * user input via stdin, and turn each line of stdout into an
 * `assistant_message` AgentEvent (line classifier — coarse, refined later).
 *
 * We don't ship richer structured-event extraction yet because Claude Code
 * doesn't emit machine-parseable events on stdout when running
 * interactively — AO drives state via JSONL hooks written by the CLI into
 * the workspace, which is a much larger surface. Tools / cost / structured
 * tool events stay off in capabilities until that lands.
 *
 * See `.tmp-ao/packages/plugins/agent-claude-code/src/index.ts` for the
 * reference launch flags and activity model.
 */

export const CLAUDE_CODE_CLI_CAPABILITIES: AgentCapabilities = {
  // Claude Code has its own internal tool catalog but we don't see it on
  // stdout, so we can't model it as structured tool events for the UI.
  supports_tools: false,
  supports_structured_events: false,
  supports_clarification_tool: false,
  supports_resume: true,
  supports_cost: false,
  supports_mcp: true,
  supports_working_directory: true,
}

/** Knobs unique to this adapter (kept off the slot-stable AgentStartConfig). */
export interface ClaudeCodeCliExtras {
  /** Path to the `claude` binary. Defaults to `claude` on PATH. */
  binaryPath?: string
  /** Append-system-prompt content — extra system prompt added to the chat. */
  appendSystemPrompt?: string
  /** If true, pass --dangerously-skip-permissions (matches AO's
   *  `permissionless` / `auto-edit` modes). */
  skipPermissions?: boolean
  /** Resume the most recent conversation via `--continue`. */
  resumeLast?: boolean
}

const ANSI_LINE_NOISE_RE = /^[\s>$#%\-=*]+$/

export class ClaudeCodeCliAdapter extends PtyAgentBase {
  constructor() {
    super({ kind: 'claude-code-cli', capabilities: CLAUDE_CODE_CLI_CAPABILITIES })
  }

  protected plan(cfg: AgentStartConfig): PtyLaunchPlan {
    const extras = (cfg.extras ?? {}) as ClaudeCodeCliExtras
    const argv: string[] = [extras.binaryPath ?? 'claude']
    if (extras.skipPermissions) argv.push('--dangerously-skip-permissions')
    if (cfg.model) argv.push('--model', cfg.model)
    if (extras.appendSystemPrompt ?? cfg.systemPrompt) {
      argv.push('--append-system-prompt', String(extras.appendSystemPrompt ?? cfg.systemPrompt))
    }
    if (extras.resumeLast) argv.push('--continue')
    return {
      argv,
      cwd: cfg.cwd,
      env: {
        // Tell Claude Code that it's NOT running inside another Claude Code
        // session — otherwise it refuses to start with "nested agent
        // detected". AO sets the same.
        CLAUDECODE: '',
      },
    }
  }

  protected classify(line: string): AgentEvent | null {
    // Drop the obvious prompt redraw / decoration lines so the chat doesn't
    // get flooded with "> " indicators after every keystroke.
    if (!line || ANSI_LINE_NOISE_RE.test(line)) return null
    return { type: 'assistant_message', text: line, ts: Date.now() }
  }
}
