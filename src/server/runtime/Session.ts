import { EventEmitter } from 'node:events'
import {
  createSdkMcpServer,
  query,
  type Query,
  type SdkMcpToolDefinition,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentRole, AgentState } from '../../core/types.js'
import { AsyncQueue } from './AsyncQueue.js'
import {
  createClarificationTool,
  type ClarificationGateway,
  type ClarificationRequest,
} from './tools/requestClarification.js'

type AnyTool = SdkMcpToolDefinition<any>

export interface SessionTextMessage {
  role: 'assistant' | 'user' | 'system'
  text: string
  timestamp: number
}

export type SessionEvent =
  | { type: 'message'; agentRunId: string; message: SessionTextMessage }
  | { type: 'state'; agentRunId: string; state: AgentState }
  | { type: 'clarification:requested'; agentRunId: string; req: ClarificationRequest }
  | { type: 'clarification:resolved'; agentRunId: string; id: string }
  | { type: 'closed'; agentRunId: string }

export type ToolPreset = 'none' | 'claude_code'

export interface SessionOptions {
  id: string
  role: AgentRole
  /** Display label for the agent (e.g. "implementer", "leader", "drone-1"). */
  label?: string
  /** Role-specific system prompt. Required for non-default sessions. */
  systemPrompt?: string
  /** Additional MCP tools beyond request_clarification. */
  extraTools?: AnyTool[]
  /** Model override, otherwise SDK default. */
  model?: string
  /** Names of tools the agent is allowed to call (MCP qualified). */
  allowedToolNames?: string[]
  /** Working directory for the agent. File tools resolve paths against this. */
  cwd?: string
  /**
   * Built-in tool preset.
   * - 'none' (default): only the SDK-MCP tools (request_clarification, etc.)
   * - 'claude_code': the full Claude Code toolset (Read/Edit/Write/Glob/Grep/Bash/...)
   *   Use this for drones that need to edit code inside a worktree. Permissions
   *   are auto-bypassed; scope safety via `cwd`.
   */
  toolPreset?: ToolPreset
}

const MCP_NAMESPACE = 'agentyard'
const CLARIFICATION_TOOL_NAME = `mcp__${MCP_NAMESPACE}__request_clarification`

/**
 * One Claude Agent SDK session. Wraps query() with a streamable input
 * channel, an event emitter for SDK output, and a clarification gateway
 * that lets the agent ask the user questions mid-turn.
 */
export class Session extends EventEmitter implements ClarificationGateway {
  private inputQueue = new AsyncQueue<SDKUserMessage>()
  private q?: Query
  private pendingClarifications = new Map<string, (answer: string) => void>()
  private _state: AgentState = 'idle'
  private consumePromise?: Promise<void>

  // Bookkeeping for ask() — waits for the next 'result' boundary.
  private askInflight = false
  private askText = ''
  private askResolver: ((text: string) => void) | null = null
  private askRejecter: ((err: Error) => void) | null = null

  constructor(public readonly opts: SessionOptions) {
    super()
  }

  get id(): string {
    return this.opts.id
  }

  get role(): AgentRole {
    return this.opts.role
  }

  get state(): AgentState {
    return this._state
  }

  start(): void {
    if (this.q) throw new Error('Session already started')

    const clarificationTool = createClarificationTool(this) as AnyTool
    const allTools: AnyTool[] = [clarificationTool, ...(this.opts.extraTools ?? [])]
    const mcp = createSdkMcpServer({
      name: MCP_NAMESPACE,
      tools: allTools,
      alwaysLoad: true,
    })

    const defaultAllowed = [
      CLARIFICATION_TOOL_NAME,
      ...(this.opts.extraTools ?? []).map((t) => `mcp__${MCP_NAMESPACE}__${t.name}`),
    ]
    const allowedTools = this.opts.allowedToolNames ?? defaultAllowed

    const useClaudeCode = this.opts.toolPreset === 'claude_code'
    const tools = useClaudeCode
      ? ({ type: 'preset', preset: 'claude_code' } as const)
      : []
    // For agents with the claude_code preset we also pre-approve every tool so
    // file edits / Bash calls don't block on a permission prompt.
    const permissionMode = useClaudeCode ? 'bypassPermissions' : 'default'
    // Agent definition limits the agent to a focused tool set; when using the
    // Claude Code preset we omit `tools` from the agent so it can use all of them.
    const agentToolsForDef = useClaudeCode ? undefined : allowedTools

    this.q = query({
      prompt: this.inputQueue,
      options: {
        mcpServers: { [MCP_NAMESPACE]: mcp },
        tools,
        ...(useClaudeCode
          ? { permissionMode, allowDangerouslySkipPermissions: true }
          : { allowedTools }),
        persistSession: false,
        settingSources: [],
        ...(this.opts.cwd ? { cwd: this.opts.cwd } : {}),
        ...(this.opts.systemPrompt
          ? {
              agents: {
                'agentyard-agent': {
                  description: 'AgentYard runtime agent',
                  prompt: this.opts.systemPrompt,
                  ...(agentToolsForDef ? { tools: agentToolsForDef } : {}),
                },
              },
              agent: 'agentyard-agent',
            }
          : {}),
        ...(this.opts.model ? { model: this.opts.model } : {}),
      },
    })

    this.consumePromise = this.consume()
  }

  private async consume(): Promise<void> {
    try {
      for await (const msg of this.q!) {
        this.handleSdkMessage(msg)
      }
      this.setState('done')
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      this.emitEvent({
        type: 'message',
        agentRunId: this.id,
        message: { role: 'system', text: `[error] ${text}`, timestamp: Date.now() },
      })
      this.setState('failed')
      this.rejectAsk(new Error(text))
    } finally {
      this.emitEvent({ type: 'closed', agentRunId: this.id })
    }
  }

  private handleSdkMessage(msg: SDKMessage): void {
    if (msg.type === 'assistant') {
      const content = msg.message.content
      let text = ''
      let toolUseCount = 0
      for (const block of content) {
        if (block.type === 'text') {
          text += block.text
        } else if (block.type === 'tool_use') {
          toolUseCount++
        }
      }
      if (text.trim().length > 0) {
        this.emitEvent({
          type: 'message',
          agentRunId: this.id,
          message: { role: 'assistant', text, timestamp: Date.now() },
        })
        if (this.askInflight) this.askText += (this.askText ? '\n' : '') + text
      }
      if (toolUseCount > 0) {
        this.setState('tool_running')
      } else {
        this.setState('thinking')
      }
    } else if (msg.type === 'result') {
      this.setState('idle')
      this.resolveAsk()
    }
    // Other message types (system, user echo, tool_result, partial) are
    // ignored for the chat surface in Phase 2.
  }

  /** Push a user message into the agent's input stream. */
  sendUserMessage(text: string): void {
    if (!this.q) throw new Error('Session not started')
    this.emitEvent({
      type: 'message',
      agentRunId: this.id,
      message: { role: 'user', text, timestamp: Date.now() },
    })
    this.inputQueue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    })
    this.setState('thinking')
  }

  /**
   * Send a user message and resolve when the agent finishes its turn
   * (`result` boundary). Returns the assistant text accumulated during
   * that turn. Used by inter-agent delegation tools (assign_task).
   */
  ask(text: string): Promise<string> {
    if (this.askInflight) {
      return Promise.reject(new Error(`Session ${this.id} already has an in-flight ask()`))
    }
    this.askInflight = true
    this.askText = ''
    const p = new Promise<string>((resolve, reject) => {
      this.askResolver = resolve
      this.askRejecter = reject
    })
    this.sendUserMessage(text)
    return p
  }

  private resolveAsk(): void {
    if (!this.askInflight) return
    const r = this.askResolver
    const text = this.askText
    this.askInflight = false
    this.askResolver = null
    this.askRejecter = null
    this.askText = ''
    r?.(text)
  }

  private rejectAsk(err: Error): void {
    if (!this.askInflight) return
    const r = this.askRejecter
    this.askInflight = false
    this.askResolver = null
    this.askRejecter = null
    this.askText = ''
    r?.(err)
  }

  /** Resolve a pending request_clarification call with the user's answer. */
  resolveClarification(id: string, answer: string): boolean {
    const resolver = this.pendingClarifications.get(id)
    if (!resolver) return false
    this.pendingClarifications.delete(id)
    resolver(answer)
    this.emitEvent({
      type: 'message',
      agentRunId: this.id,
      message: { role: 'user', text: answer, timestamp: Date.now() },
    })
    this.emitEvent({ type: 'clarification:resolved', agentRunId: this.id, id })
    this.setState('thinking')
    return true
  }

  /** ClarificationGateway — called by request_clarification tool. */
  request(req: ClarificationRequest): Promise<string> {
    return new Promise<string>((resolve) => {
      this.pendingClarifications.set(req.id, resolve)
      this.setState('awaiting_clarification')
      this.emitEvent({ type: 'clarification:requested', agentRunId: this.id, req })
    })
  }

  async close(): Promise<void> {
    this.q?.close()
    this.inputQueue.close()
    this.rejectAsk(new Error('Session closed'))
    await this.consumePromise?.catch(() => {})
  }

  private setState(state: AgentState): void {
    if (this._state === state) return
    this._state = state
    this.emitEvent({ type: 'state', agentRunId: this.id, state })
  }

  private emitEvent(ev: SessionEvent): void {
    this.emit('event', ev)
  }
}
