import { z } from 'zod/v4'
import type { AgentRole, AgentState } from './types.js'

/**
 * Plugin slot interfaces for the runner abstraction.
 *
 * AgentYard's "Session" today is hard-wired to the Claude Agent SDK. This
 * module defines the slot interfaces that let future runners (Claude Code
 * CLI, Codex CLI, …) plug in alongside it.
 *
 * See docs/backend-runner-scheduler-plan.md (Phase 0) for the full design.
 * This file is **interfaces only** — no runtime behavior. Existing code
 * keeps working until Phase 1 wraps Session as the claude-sdk adapter.
 */

export type AgentKind = 'claude-sdk' | 'claude-code-cli' | 'codex-cli'
export type RuntimeKind = 'sdk' | 'pty'

/**
 * Canonical lifecycle states (mirror AO). The chat-surface AgentState in
 * core/types.ts is a thinner view of this — that one is "what is the
 * conversation doing right now" (`thinking`, `tool_running`, …), while
 * AgentLifecycleState covers the full "is this session alive" axis.
 *
 * Both exist on purpose: the chat panel cares about turn-level state, the
 * lifecycle manager + dashboard care about long-run state.
 */
export type AgentLifecycleState =
  | 'not_started'
  | 'working'
  | 'idle'
  | 'needs_input'
  | 'stuck'
  | 'detecting'
  | 'done'
  | 'terminated'

export type AgentTerminalReason =
  | 'manually_killed'
  | 'runtime_lost'
  | 'agent_process_exited'
  | 'probe_failure'
  | 'error_in_process'
  | 'auto_cleanup'
  | 'pr_merged'

export interface AgentCapabilities {
  /** Can register MCP tools (only `claude-sdk` today). */
  supports_tools: boolean
  /** Emits tool_use / tool_result events, not just text. */
  supports_structured_events: boolean
  /** request_clarification works (needs MCP injection). */
  supports_clarification_tool: boolean
  /** Can resume a conversation across server restart. */
  supports_resume: boolean
  /** Reports token cost in events. */
  supports_cost: boolean
  /** Can load external MCP servers. */
  supports_mcp: boolean
  /** Honors cwd. */
  supports_working_directory: boolean
}

export interface AgentStartConfig {
  /** Stable handle id chosen by the caller (or omit for the adapter to mint one). */
  id?: string
  role: AgentRole
  /** Display label for the agent (e.g. "feature:9:chat", "analyze/leader"). */
  label?: string
  /** Working directory for file tools / scripts / Bash. */
  cwd?: string
  /** Initial system prompt — the agent's body + any pre-rendered skill context. */
  systemPrompt?: string
  /** Optional model override; adapter falls back to its default. */
  model?: string
  /**
   * Adapter-specific knobs. Each adapter declares its own typed shape in its
   * own module and validates this opaquely. Keeps the slot interface stable
   * while letting individual adapters carry their own configuration.
   */
  extras?: unknown
}

export interface AgentRuntimeContext {
  /**
   * Append-only event sink. Adapters MUST call this for every AgentEvent they
   * produce before delivering it to subscribers, so the persistence layer is
   * never bypassed. In Phase 0/1 this is a no-op shim; Phase 4 wires the
   * runner_events table.
   */
  recordEvent: (sessionId: string, event: AgentEvent) => void
  /** Logger — Fastify's logger in production. */
  log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }
}

export interface AgentSessionStatus {
  id: string
  state: AgentLifecycleState
  /** Chat-surface state — see comment on AgentLifecycleState. */
  chatState: AgentState
  startedAt: number
  /** Adapter-specific extra debug fields (pid, pipe path, conversation id, …). */
  extras?: Record<string, unknown>
}

export interface AgentHandle {
  readonly id: string
  readonly kind: AgentKind
  readonly runtime: RuntimeKind
  readonly capabilities: AgentCapabilities
  /** Push a user message; non-blocking. Throws if the session has exited. */
  send(text: string): Promise<void>
  /** Best-effort graceful stop, then SIGKILL after 5s for PTY runners. */
  stop(): Promise<void>
  /** Cold snapshot of current state. */
  getStatus(): Promise<AgentSessionStatus>
  /**
   * Stream of normalized events. Adapters MUST emit `state` events whenever
   * the lifecycle moves, and an `exited` event exactly once before the stream
   * ends. The iterable is single-consumer; use a fan-out helper if multiple
   * subscribers need it (Phase 4 persistence does the fan-out via recordEvent).
   */
  events: AsyncIterable<AgentEvent>
}

export interface AgentAdapter {
  readonly kind: AgentKind
  readonly runtime: RuntimeKind
  readonly capabilities: AgentCapabilities
  start(cfg: AgentStartConfig, ctx: AgentRuntimeContext): Promise<AgentHandle>
}

// ─── AgentEvent ─────────────────────────────────────────────────────────────

/**
 * Normalized event shape every adapter emits. Adding a new variant is
 * forward-compatible IF every consumer's switch has a `default` branch;
 * removing or changing payload shape is a breaking change.
 */
export type AgentEvent =
  | { type: 'assistant_message'; text: string; ts: number }
  | { type: 'user_message_echo'; text: string; ts: number }
  | { type: 'system'; text: string; ts: number }
  /** Only emitted when capabilities.supports_structured_events. */
  | { type: 'tool_use'; tool: string; toolUseId: string; input: unknown; ts: number }
  /** Only emitted when capabilities.supports_structured_events. */
  | { type: 'tool_result'; tool: string; toolUseId: string; output: unknown; isError?: boolean; ts: number }
  | { type: 'state'; state: AgentLifecycleState; ts: number }
  | { type: 'needs_input'; question: string; toolUseId?: string; ts: number }
  /** Only emitted when capabilities.supports_cost. */
  | { type: 'cost'; inputTokens: number; outputTokens: number; ts: number }
  | { type: 'error'; message: string; ts: number }
  | { type: 'exited'; code: number | null; reason?: AgentTerminalReason; ts: number }

const ts = z.number()

/**
 * Zod schema for AgentEvent — used at persistence boundaries (Phase 4) to
 * validate payloads written/read from runner_events.payload_json. Mirrors the
 * union above; keep them in sync (a test in plugins.test.ts checks parity).
 */
export const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assistant_message'), text: z.string(), ts }),
  z.object({ type: z.literal('user_message_echo'), text: z.string(), ts }),
  z.object({ type: z.literal('system'), text: z.string(), ts }),
  z.object({
    type: z.literal('tool_use'),
    tool: z.string(),
    toolUseId: z.string(),
    input: z.unknown(),
    ts,
  }),
  z.object({
    type: z.literal('tool_result'),
    tool: z.string(),
    toolUseId: z.string(),
    output: z.unknown(),
    isError: z.boolean().optional(),
    ts,
  }),
  z.object({
    type: z.literal('state'),
    state: z.enum([
      'not_started',
      'working',
      'idle',
      'needs_input',
      'stuck',
      'detecting',
      'done',
      'terminated',
    ]),
    ts,
  }),
  z.object({
    type: z.literal('needs_input'),
    question: z.string(),
    toolUseId: z.string().optional(),
    ts,
  }),
  z.object({
    type: z.literal('cost'),
    inputTokens: z.number(),
    outputTokens: z.number(),
    ts,
  }),
  z.object({ type: z.literal('error'), message: z.string(), ts }),
  z.object({
    type: z.literal('exited'),
    code: z.number().nullable(),
    reason: z
      .enum([
        'manually_killed',
        'runtime_lost',
        'agent_process_exited',
        'probe_failure',
        'error_in_process',
        'auto_cleanup',
        'pr_merged',
      ])
      .optional(),
    ts,
  }),
])
