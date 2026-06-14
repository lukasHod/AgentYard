import { randomUUID } from 'node:crypto'
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentHandle,
  AgentKind,
  AgentRuntimeContext,
  AgentSessionStatus,
  AgentStartConfig,
  RuntimeKind,
} from '../../../core/plugins.js'
import type { AgentState } from '../../../core/types.js'
import { spawnPty, type PtyProcess } from '../runtimes/ptyRuntime.js'

/**
 * Base class shared by every CLI agent adapter (claude-code-cli, codex-cli,
 * future ones). Spawns the CLI under a PTY, line-buffers stdout, and lets
 * the subclass classify each line into an AgentEvent.
 *
 * Subclasses implement:
 *   - `getLaunchCommand(cfg)` — argv handed to spawnPty.
 *   - `getEnv(cfg)` — env merged with process.env.
 *   - `classify(line)` — turn one line of stdout into one AgentEvent (or
 *     null to drop it; e.g. terminal control sequences).
 *
 * Capabilities + kind are declared statically by the subclass via the
 * constructor — the base just enforces the AgentAdapter contract.
 */

export interface PtyAdapterConfig {
  kind: AgentKind
  capabilities: AgentCapabilities
  /** PTY rolling buffer cap. Defaults to 1 MB. */
  bufferLimit?: number
}

export interface PtyLaunchPlan {
  argv: string[]
  env?: Record<string, string>
  cwd?: string
  cols?: number
  rows?: number
}

export abstract class PtyAgentBase implements AgentAdapter {
  readonly kind: AgentKind
  readonly runtime: RuntimeKind = 'pty'
  readonly capabilities: AgentCapabilities

  constructor(private readonly cfg: PtyAdapterConfig) {
    this.kind = cfg.kind
    this.capabilities = cfg.capabilities
  }

  /** Build the spawn plan from the slot-stable AgentStartConfig. */
  protected abstract plan(cfg: AgentStartConfig): PtyLaunchPlan

  /**
   * Turn one line of stdout into one AgentEvent. Return null to drop the
   * line (e.g. ANSI control sequences, prompt redraw, blank). Subclasses
   * MAY emit `state` events here to drive lifecycle transitions; the base
   * also auto-emits `state: 'working'` on first data and `state: 'idle'`
   * after silence (debounced) so subclasses don't have to.
   */
  protected abstract classify(line: string): AgentEvent | null

  async start(cfg: AgentStartConfig, ctx: AgentRuntimeContext): Promise<AgentHandle> {
    const id = cfg.id ?? `pty-${randomUUID().slice(0, 8)}`
    const plan = this.plan(cfg)

    const pty = spawnPty({
      argv: plan.argv,
      cwd: plan.cwd ?? cfg.cwd,
      env: plan.env,
      cols: plan.cols,
      rows: plan.rows,
      bufferLimit: this.cfg.bufferLimit,
    })

    return new PtyAgentHandle({
      id,
      kind: this.kind,
      capabilities: this.capabilities,
      pty,
      ctx,
      classify: this.classify.bind(this),
    })
  }
}

interface PtyAgentHandleDeps {
  id: string
  kind: AgentKind
  capabilities: AgentCapabilities
  pty: PtyProcess
  ctx: AgentRuntimeContext
  classify: (line: string) => AgentEvent | null
}

const IDLE_DEBOUNCE_MS = 1500

class PtyAgentHandle implements AgentHandle {
  readonly id: string
  readonly kind: AgentKind
  readonly runtime: RuntimeKind = 'pty'
  readonly capabilities: AgentCapabilities

  private readonly pty: PtyProcess
  private readonly ctx: AgentRuntimeContext
  private readonly classify: (line: string) => AgentEvent | null

  private readonly startedAt = Date.now()
  private exited = false
  private lineBuf = ''
  private chatState: AgentState = 'idle'
  private idleTimer: NodeJS.Timeout | null = null

  private readonly subscribers: Array<{
    push(ev: AgentEvent): void
    close(): void
  }> = []

  constructor(deps: PtyAgentHandleDeps) {
    this.id = deps.id
    this.kind = deps.kind
    this.capabilities = deps.capabilities
    this.pty = deps.pty
    this.ctx = deps.ctx
    this.classify = deps.classify

    deps.pty.events.on('data', (chunk: string) => this.onData(chunk))
    deps.pty.events.on('exit', ({ code }: { code: number | null }) => this.onExit(code))
  }

  async send(text: string): Promise<void> {
    if (this.exited) throw new Error(`PTY session ${this.id} has exited`)
    // Most interactive CLIs need a trailing newline to submit.
    const payload = text.endsWith('\n') ? text : text + '\n'
    this.pty.write(payload)
    this.emit({
      type: 'user_message_echo',
      text,
      ts: Date.now(),
    })
    this.setChatState('thinking')
  }

  async stop(): Promise<void> {
    await this.pty.kill()
  }

  async getStatus(): Promise<AgentSessionStatus> {
    return {
      id: this.id,
      state: this.exited ? 'terminated' : 'working',
      chatState: this.chatState,
      startedAt: this.startedAt,
      extras: { pid: this.pty.pid },
    }
  }

  get events(): AsyncIterable<AgentEvent> {
    const handle = this
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
        const buffer: AgentEvent[] = []
        let waiter: ((res: IteratorResult<AgentEvent>) => void) | null = null
        let done = false
        const subscriber = {
          push(ev: AgentEvent): void {
            if (done) return
            if (waiter) {
              const r = waiter
              waiter = null
              r({ value: ev, done: false })
            } else {
              buffer.push(ev)
            }
          },
          close(): void {
            done = true
            if (waiter) {
              const r = waiter
              waiter = null
              r({ value: undefined, done: true })
            }
          },
        }
        handle.subscribers.push(subscriber)
        return {
          next(): Promise<IteratorResult<AgentEvent>> {
            if (buffer.length > 0) return Promise.resolve({ value: buffer.shift()!, done: false })
            if (done) return Promise.resolve({ value: undefined, done: true })
            return new Promise((resolve) => {
              waiter = resolve
            })
          },
          async return(): Promise<IteratorResult<AgentEvent>> {
            subscriber.close()
            const idx = handle.subscribers.indexOf(subscriber)
            if (idx >= 0) handle.subscribers.splice(idx, 1)
            return { value: undefined, done: true }
          },
        }
      },
    }
  }

  private onData(chunk: string): void {
    if (this.chatState !== 'thinking') this.setChatState('thinking')
    this.armIdleTimer()
    this.lineBuf += chunk
    // Split on either LF or CR — terminals tend to use either, sometimes
    // both. We swallow the empty pieces and feed each non-empty piece to
    // the classifier.
    const parts = this.lineBuf.split(/\r?\n/)
    this.lineBuf = parts.pop() ?? ''
    for (const part of parts) {
      const clean = stripAnsi(part).trimEnd()
      if (!clean) continue
      const event = this.classify(clean)
      if (event) this.emit(event)
    }
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (this.exited) return
      this.setChatState('idle')
    }, IDLE_DEBOUNCE_MS)
  }

  private setChatState(state: AgentState): void {
    if (this.chatState === state) return
    this.chatState = state
    const lifecycle = state === 'idle' ? 'idle' : state === 'failed' ? 'terminated' : 'working'
    this.emit({ type: 'state', state: lifecycle, ts: Date.now() })
  }

  private onExit(code: number | null): void {
    if (this.exited) return
    this.exited = true
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    // Flush any trailing partial line.
    if (this.lineBuf) {
      const clean = stripAnsi(this.lineBuf).trimEnd()
      this.lineBuf = ''
      if (clean) {
        const event = this.classify(clean)
        if (event) this.emit(event)
      }
    }
    this.emit({
      type: 'exited',
      code,
      reason: code === 0 ? undefined : 'agent_process_exited',
      ts: Date.now(),
    })
    for (const sub of this.subscribers) sub.close()
    this.subscribers.length = 0
  }

  private emit(ev: AgentEvent): void {
    this.ctx.recordEvent(this.id, ev)
    for (const sub of this.subscribers) sub.push(ev)
  }
}

/**
 * Strip CSI / OSC / SGR control sequences from a string so the classifier
 * sees clean lines. We tolerate but don't preserve color codes — the chat
 * surface renders plain text anyway. Dashboard PTY attach (Phase 9) reads
 * the rolling buffer directly via xterm.js, which understands the codes.
 */
export function stripAnsi(s: string): string {
  // CSI sequences: ESC [ ... letter
  // OSC sequences: ESC ] ... BEL (or ESC backslash)
  // Other ESC sequences: ESC followed by one byte.
  // Plus solitary BEL / SO / SI.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}
