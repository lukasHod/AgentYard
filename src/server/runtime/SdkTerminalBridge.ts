import { randomUUID } from 'node:crypto'
import {
  appendTerminalChunk,
  createSdkBridgeTerminalSession,
  updateTerminalSession,
  getTerminalSession,
} from '../terminalStore.js'
import type { IAgentSession } from './IAgentSession.js'
import type { SessionEvent } from './Session.js'
import type { TypedIOServer } from '../socketTypes.js'

/**
 * Bridges an SDK agent session to a virtual xterm.js terminal panel.
 *
 * Creates a terminal_sessions row with runtimeKind='sdk-bridge', listens to
 * the session's event stream, formats each event as ANSI-coloured text, and
 * emits it via socket.io terminal:data so TerminalPanel.tsx renders it
 * exactly like output from a PTY process. User input typed in the terminal
 * is collected line-by-line and sent to the agent as a user message.
 */
export class SdkTerminalBridge {
  readonly terminalSessionId: string
  private inputBuffer = ''
  private pendingClarificationId: string | null = null
  private readonly eventListener: (e: SessionEvent) => void

  constructor(
    private readonly session: IAgentSession,
    private readonly io: TypedIOServer,
    private readonly ctx: {
      role?: string
      label?: string
      cwd?: string
      planetId?: number | null
      featureId?: number | null
      workflowRunId?: string | null
      nodeRunId?: string | null
    },
  ) {
    this.terminalSessionId = `term-${randomUUID().slice(0, 8)}`
    this.eventListener = (e) => this.handleSessionEvent(e)
  }

  /** Register the virtual terminal session and start streaming events. */
  attach(): void {
    const descriptor = createSdkBridgeTerminalSession({
      id: this.terminalSessionId,
      agentSessionId: this.session.id,
      role: this.ctx.role ?? this.session.role,
      label: this.ctx.label ?? null,
      cwd: this.ctx.cwd ?? null,
      planetId: this.ctx.planetId ?? null,
      featureId: this.ctx.featureId ?? null,
      workflowRunId: this.ctx.workflowRunId ?? null,
      nodeRunId: this.ctx.nodeRunId ?? null,
    })

    // Broadcast so all connected clients add this session to their terminal list.
    this.io.emit('terminal:session:added', descriptor)

    this.session.on('event', this.eventListener)

    // Print a brief header so the user knows this is an SDK-driven terminal.
    const model = this.session.model ?? 'default model'
    this.writeTerminal(
      `\x1b[2m⬡ AgentYard SDK Agent  ${this.session.role} · ${model}\x1b[0m\r\n\r\n`,
    )
  }

  /** Detach event listener and mark the virtual session as exited in the DB. */
  detach(exitCode: number = 0): void {
    this.session.off('event', this.eventListener)
    updateTerminalSession(this.terminalSessionId, {
      state: exitCode === 0 ? 'exited' : 'failed',
      exitCode,
      exitSignal: null,
      pid: null,
      lastExitedAt: Date.now(),
    })
    // Emit a terminal:data sentinel so the panel knows the stream ended.
    this.writeTerminal(`\r\n\x1b[2m[session closed]\x1b[0m\r\n`)
    // Let clients know the session state changed.
    const descriptor = getTerminalSession(this.terminalSessionId)
    if (descriptor) {
      this.io.emit('terminal:session:update', descriptor)
    }
  }

  /**
   * Called by the socket handler when the user types in the xterm.js panel.
   * We collect input until \r (Enter) is received, then send the accumulated
   * line as a user message to the agent.
   */
  write(data: string): void {
    for (const char of data) {
      if (char === '\r' || char === '\n') {
        const line = this.inputBuffer.trim()
        this.inputBuffer = ''
        if (line.length > 0) {
          this.writeTerminal(`\r\n`)
          this.submitLine(line)
        } else {
          this.writeTerminal(`\r\n`)
        }
      } else if (char === '\x7f' || char === '\b') {
        if (this.inputBuffer.length > 0) {
          this.inputBuffer = this.inputBuffer.slice(0, -1)
          this.writeTerminal('\b \b')
        }
      } else if (char >= ' ') {
        this.inputBuffer += char
        this.writeTerminal(char)
      }
    }
  }

  private submitLine(line: string): void {
    // If Claude used request_clarification, resolve it. Otherwise send as a
    // new user turn. This handles both interactive-question nodes and free-form
    // multi-turn conversation.
    if (this.pendingClarificationId) {
      const id = this.pendingClarificationId
      this.pendingClarificationId = null
      this.session.resolveClarification(id, line)
    } else {
      this.session.sendUserMessage(line)
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private handleSessionEvent(ev: SessionEvent): void {
    switch (ev.type) {
      case 'state':
        this.handleState(ev.state)
        break
      case 'message':
        if (ev.message.role === 'assistant') {
          // Render assistant text directly. Ensure it starts on a fresh line.
          this.writeTerminal(`\r\n${ev.message.text}\r\n`)
        }
        // user echo and system messages are not re-rendered (input is already echoed locally)
        break
      case 'tool_use':
        this.writeTerminal(formatToolUse(ev.tool, ev.input))
        break
      case 'tool_result':
        this.writeTerminal(formatToolResult(ev.output, ev.isError))
        break
      case 'clarification:requested':
        this.pendingClarificationId = ev.req.id
        this.writeTerminal(
          `\r\n\x1b[33m⚠ \x1b[0m${ev.req.question}\r\n` +
            `\x1b[2m❯ \x1b[0m`,
        )
        break
      case 'clarification:resolved':
        this.pendingClarificationId = null
        break
      case 'cost':
        // Show token usage in dim text so it doesn't clutter the output.
        this.writeTerminal(
          `\x1b[2m↑ ${ev.inputTokens} ↓ ${ev.outputTokens} tokens\x1b[0m\r\n`,
        )
        break
      case 'closed':
        this.detach(0)
        break
    }
  }

  private handleState(state: string): void {
    switch (state) {
      case 'thinking':
        this.writeTerminal(`\x1b[2m✦ Thinking…\x1b[0m\r\n`)
        break
      case 'tool_running':
        // tool_use event already printed a line; no extra output needed.
        break
      case 'done':
        this.writeTerminal(`\r\n\x1b[2m✓ Done\x1b[0m\r\n`)
        break
      case 'failed':
        this.writeTerminal(`\r\n\x1b[31m✗ Failed\x1b[0m\r\n`)
        break
    }
  }

  private writeTerminal(text: string): void {
    const timestamp = Date.now()
    // Broadcast to all clients attached to this terminal's socket room.
    this.io.to(this.terminalSessionId).emit('terminal:data', {
      sessionId: this.terminalSessionId,
      data: text,
      timestamp,
    })
    // Persist in the transcript so late-joining clients get a snapshot.
    try {
      appendTerminalChunk(this.terminalSessionId, text, timestamp)
    } catch {
      // Best-effort — the session row may have been deleted.
    }
  }
}

// ── ANSI formatters ────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  read_file: '● Reading',
  write_file: '● Writing',
  edit_file: '● Editing',
  multi_edit_file: '● Editing',
  bash: '● Bash',
  glob: '● Glob',
  grep: '● Grep',
  ls: '● LS',
}

function formatToolUse(toolName: string, input: unknown): string {
  const icon = TOOL_ICONS[toolName] ?? `● ${toolName}`
  let detail = ''
  if (input && typeof input === 'object') {
    const inp = input as Record<string, unknown>
    detail = (inp['file_path'] ?? inp['path'] ?? inp['command'] ?? inp['pattern'] ?? '') as string
  }
  return `\r\n\x1b[32m${icon}\x1b[0m${detail ? ` \x1b[2m${detail}\x1b[0m` : ''}\r\n`
}

function formatToolResult(output: unknown, isError?: boolean): string {
  const text =
    typeof output === 'string'
      ? output
      : Array.isArray(output)
        ? output.map((b: unknown) => (typeof b === 'object' && b !== null && 'text' in b ? (b as { text: string }).text : '')).join('')
        : JSON.stringify(output)
  const preview = text.split('\n').slice(0, 6).join('\r\n  ⎿  ')
  const color = isError ? '\x1b[31m' : '\x1b[0m'
  return `  \x1b[2m⎿\x1b[0m  ${color}${preview}\x1b[0m\r\n`
}

// ── Registry ───────────────────────────────────────────────────────────────────

/** Global map from terminalSessionId → SdkTerminalBridge. Consulted by socketHandlers. */
const registry = new Map<string, SdkTerminalBridge>()

export function registerSdkBridge(bridge: SdkTerminalBridge): void {
  registry.set(bridge.terminalSessionId, bridge)
}

export function unregisterSdkBridge(terminalSessionId: string): void {
  registry.delete(terminalSessionId)
}

export function getSdkBridge(terminalSessionId: string): SdkTerminalBridge | undefined {
  return registry.get(terminalSessionId)
}
