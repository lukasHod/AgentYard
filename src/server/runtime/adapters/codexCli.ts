import type {
  AgentCapabilities,
  AgentEvent,
  AgentStartConfig,
} from '../../../core/plugins.js'
import { PtyAgentBase, type PtyLaunchPlan } from './ptyAgentBase.js'

/**
 * Adapter for OpenAI's Codex CLI (`codex`), running under a PTY.
 *
 * Mirrors the launch flags AO uses in
 * `.tmp-ao/packages/plugins/agent-codex/src/index.ts`:
 *   - `--no-update-check` to silence the version banner (line-noise the
 *     classifier would otherwise pick up).
 *   - `-c model_instructions_file=…` / `-c developer_instructions=…` for
 *     the system prompt.
 *   - `--model <m>` for model selection.
 *
 * Codex is Rust-based and emits prompt redraws on stdout we want to
 * suppress; the classifier drops blank / decoration lines.
 */

export const CODEX_CLI_CAPABILITIES: AgentCapabilities = {
  supports_tools: false,
  supports_structured_events: false,
  supports_clarification_tool: false,
  supports_resume: false,
  supports_cost: false,
  supports_mcp: false,
  supports_working_directory: true,
}

export interface CodexCliExtras {
  binaryPath?: string
  /** Pass-through extra flags appended to the argv after the standard ones. */
  extraArgs?: string[]
  /** Disable Codex's network update check (default true). */
  noUpdateCheck?: boolean
}

const ANSI_LINE_NOISE_RE = /^[\s>$#%\-=*]+$/

export class CodexCliAdapter extends PtyAgentBase {
  constructor() {
    super({ kind: 'codex-cli', capabilities: CODEX_CLI_CAPABILITIES })
  }

  protected plan(cfg: AgentStartConfig): PtyLaunchPlan {
    const extras = (cfg.extras ?? {}) as CodexCliExtras
    const argv: string[] = [extras.binaryPath ?? 'codex']
    if (extras.noUpdateCheck !== false) argv.push('--no-update-check')
    if (cfg.model) argv.push('--model', cfg.model)
    if (cfg.systemPrompt) {
      argv.push('-c', `developer_instructions=${cfg.systemPrompt}`)
    }
    if (extras.extraArgs?.length) argv.push(...extras.extraArgs)
    return { argv, cwd: cfg.cwd }
  }

  protected classify(line: string): AgentEvent | null {
    if (!line || ANSI_LINE_NOISE_RE.test(line)) return null
    return { type: 'assistant_message', text: line, ts: Date.now() }
  }
}
