import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentHandle,
  AgentKind,
  AgentLifecycleState,
  AgentRuntimeContext,
  AgentSessionStatus,
  AgentStartConfig,
  RuntimeKind,
} from '../../../core/plugins.js'
import type { AgentState } from '../../../core/types.js'
import { Session, type SessionEvent, type SessionOptions } from '../Session.js'

/**
 * Phase 1 adapter: wraps the existing Claude Agent SDK Session as an
 * AgentAdapter / AgentHandle. Zero behavior change vs. talking to Session
 * directly — the adapter just translates SessionEvent -> AgentEvent and
 * exposes the AgentHandle surface.
 *
 * Later phases (Phase 4 persistence, Phase 5 CLI adapters) plug into the
 * same interface without touching the SDK session class.
 */

export const CLAUDE_SDK_CAPABILITIES: AgentCapabilities = {
  supports_tools: true,
  supports_structured_events: true,
  supports_clarification_tool: true,
  supports_resume: false,
  supports_cost: true,
  supports_mcp: true,
  supports_working_directory: true,
}

/**
 * Adapter-specific extras: anything from `SessionOptions` we want the caller
 * to be able to set but that doesn't fit the slot-stable AgentStartConfig.
 * Other adapters declare their own `*Extras` shape — never widen
 * AgentStartConfig with adapter-specific fields.
 */
export interface ClaudeSdkExtras
  extends Omit<SessionOptions, 'id' | 'role' | 'label' | 'systemPrompt' | 'cwd' | 'model'> {}

/**
 * Translate SessionEvent -> AgentEvent. Keeps SessionEvent as the in-process
 * shape (used by featureChat / planetChat / runWorkflowOnSessions today) and
 * AgentEvent as the wire/persistence shape going forward.
 *
 * Returns `null` for SessionEvents that don't map to anything observable on
 * the new bus (e.g. `closed` is folded into the `exited` event by the handle
 * directly because we need to know the exit reason).
 */
export function sessionEventToAgentEvent(ev: SessionEvent): AgentEvent | null {
  switch (ev.type) {
    case 'message': {
      const { role, text, timestamp } = ev.message
      if (role === 'assistant') return { type: 'assistant_message', text, ts: timestamp }
      if (role === 'user') return { type: 'user_message_echo', text, ts: timestamp }
      return { type: 'system', text, ts: timestamp }
    }
    case 'state':
      return { type: 'state', state: chatStateToLifecycle(ev.state), ts: Date.now() }
    case 'clarification:requested':
      return {
        type: 'needs_input',
        question: ev.req.question,
        toolUseId: ev.req.id,
        ts: Date.now(),
      }
    case 'clarification:resolved':
      // No direct AgentEvent for "clarification resolved" — the agent's next
      // message will appear when it processes the answer. The chat compat
      // layer (Phase 3) emits its own socket event.
      return null
    case 'tool_use':
      return {
        type: 'tool_use',
        tool: ev.tool,
        toolUseId: ev.toolUseId,
        input: ev.input,
        ts: ev.timestamp,
      }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool: ev.tool,
        toolUseId: ev.toolUseId,
        output: ev.output,
        ...(ev.isError !== undefined ? { isError: ev.isError } : {}),
        ts: ev.timestamp,
      }
    case 'cost':
      return {
        type: 'cost',
        inputTokens: ev.inputTokens,
        outputTokens: ev.outputTokens,
        ts: ev.timestamp,
      }
    case 'closed':
      // Handled by the handle so we can set the exit reason explicitly.
      return null
  }
}

/**
 * Chat-surface AgentState -> long-run AgentLifecycleState. The two axes
 * intentionally differ: AgentState is per-turn ("am I thinking?"),
 * AgentLifecycleState is per-session ("is this still alive?"). Mapping
 * collapses turn states to `working`; the lifecycle manager (Phase 4) is
 * the authority on `stuck` / `detecting` / `terminated`.
 */
function chatStateToLifecycle(state: AgentState): AgentLifecycleState {
  switch (state) {
    case 'idle':
      return 'idle'
    case 'thinking':
    case 'tool_running':
      return 'working'
    case 'awaiting_clarification':
      return 'needs_input'
    case 'done':
      return 'done'
    case 'failed':
      return 'terminated'
  }
}

class ClaudeSdkHandle implements AgentHandle {
  readonly kind: AgentKind = 'claude-sdk'
  readonly runtime: RuntimeKind = 'sdk'
  readonly capabilities = CLAUDE_SDK_CAPABILITIES

  private readonly subscribers: Array<{
    push(ev: AgentEvent): void
    close(): void
  }> = []
  private closed = false
  private readonly startedAt = Date.now()

  constructor(
    private readonly session: Session,
    private readonly ctx: AgentRuntimeContext,
  ) {
    session.on('event', (ev: SessionEvent) => this.onSessionEvent(ev))
  }

  get id(): string {
    return this.session.id
  }

  /** Internal — exposes the underlying Session for callers that still need
   * SDK-specific surfaces (tool injection, clarification gateway). Will go
   * away once everything routes through AgentEvent. */
  get _session(): Session {
    return this.session
  }

  async send(text: string): Promise<void> {
    if (this.closed) throw new Error(`Session ${this.id} has exited`)
    this.session.sendUserMessage(text)
  }

  async stop(): Promise<void> {
    await this.session.close()
  }

  async getStatus(): Promise<AgentSessionStatus> {
    return {
      id: this.id,
      state: chatStateToLifecycle(this.session.state),
      chatState: this.session.state,
      startedAt: this.startedAt,
    }
  }

  get events(): AsyncIterable<AgentEvent> {
    // Each call returns a fresh async iterator backed by a per-iterator queue.
    // The handle multicasts SessionEvent -> AgentEvent to every live iterator.
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
            if (buffer.length > 0) {
              return Promise.resolve({ value: buffer.shift()!, done: false })
            }
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

  private onSessionEvent(ev: SessionEvent): void {
    if (ev.type === 'closed') {
      const exitEvent: AgentEvent = {
        type: 'exited',
        code: this.session.state === 'failed' ? 1 : 0,
        reason: this.session.state === 'failed' ? 'error_in_process' : undefined,
        ts: Date.now(),
      }
      this.emit(exitEvent)
      this.closed = true
      // Close all subscribers so their iterators terminate cleanly.
      for (const sub of this.subscribers) sub.close()
      this.subscribers.length = 0
      return
    }

    const agentEvent = sessionEventToAgentEvent(ev)
    if (agentEvent) this.emit(agentEvent)
  }

  private emit(ev: AgentEvent): void {
    // Persistence boundary: the runtime context records the event before any
    // subscriber sees it. In Phase 0/1 this is a no-op; Phase 4 wires SQLite.
    this.ctx.recordEvent(this.id, ev)
    for (const sub of this.subscribers) sub.push(ev)
  }
}

export class ClaudeSdkAdapter implements AgentAdapter {
  readonly kind: AgentKind = 'claude-sdk'
  readonly runtime: RuntimeKind = 'sdk'
  readonly capabilities = CLAUDE_SDK_CAPABILITIES

  async start(cfg: AgentStartConfig, ctx: AgentRuntimeContext): Promise<AgentHandle> {
    const extras = (cfg.extras ?? {}) as ClaudeSdkExtras
    const session = new Session({
      id: cfg.id ?? `agent-${Math.random().toString(36).slice(2, 10)}`,
      role: cfg.role,
      ...(cfg.label !== undefined ? { label: cfg.label } : {}),
      ...(cfg.systemPrompt !== undefined ? { systemPrompt: cfg.systemPrompt } : {}),
      ...(cfg.cwd !== undefined ? { cwd: cfg.cwd } : {}),
      ...(cfg.model !== undefined ? { model: cfg.model } : {}),
      ...extras,
    })
    const handle = new ClaudeSdkHandle(session, ctx)
    session.start()
    return handle
  }
}

/** Pull the underlying Session out of a claude-sdk handle. Throws for any
 * other adapter — callers that need this are already coupled to the SDK and
 * should be moved off in later phases. */
export function unwrapClaudeSdkSession(handle: AgentHandle): Session {
  if (handle.kind !== 'claude-sdk') {
    throw new Error(
      `unwrapClaudeSdkSession: expected claude-sdk handle, got ${handle.kind}`,
    )
  }
  return (handle as ClaudeSdkHandle)._session
}
