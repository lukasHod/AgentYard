import { EventEmitter } from 'node:events'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  createSdkMcpServer,
  query,
  type McpServerConfig,
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
  /** Display label for the agent. */
  label?: string
  /** System prompt — the agent's body + any pre-rendered skill context. */
  systemPrompt?: string
  /**
   * Runtime tools registered under `mcp__ay_runtime__*` alongside
   * request_clarification. Used for leader-only tools (assign_task,
   * mark_node_complete). request_clarification is always wired by Session.
   */
  runtimeTools?: AnyTool[]
  /**
   * Script tools — registered under `mcp__ay_scripts__*` in a separate MCP
   * server so user scripts can never collide with runtime tool names.
   */
  scriptTools?: AnyTool[]
  /**
   * External MCP server configs (per-agent attached MCPs from the tool
   * library). Forwarded to the SDK's options.mcpServers as-is.
   * `${env:VAR}` substitution must be done by the caller before passing in.
   */
  mcpServerConfigs?: Record<string, McpServerConfig>
  /** Model override, otherwise SDK default. */
  model?: string
  /** Optional restrict to a subset of Claude Code tools (only used when toolPreset === 'claude_code'). */
  allowedTools?: string[]
  /** Working directory — file tools and Bash resolve against this. */
  cwd?: string
  /**
   * Built-in tool preset.
   * - 'none'        : only the MCP-registered tools (clarification, runtime, scripts, user MCPs)
   * - 'claude_code' : full Claude Code toolset (Read/Edit/Write/Glob/Grep/Bash/...)
   */
  toolPreset?: ToolPreset
  /**
   * Which on-disk settings sources the SDK loads (defaults to none — keeps
   * workflow drones/leaders sandboxed from the user's personal config).
   * Set to `['user', 'project']` for planet-chat to pick up the user's
   * installed skills and personal MCP server configs from `~/.claude/` +
   * `<cwd>/.claude/`.
   *
   * Note (2026-05): empirically this does NOT make the SDK dispatch the
   * built-in Claude Code slash commands (`/help`, `/clear`, `/mcp`, ...)
   * via streamed user input — those are rejected with "isn't available in
   * this environment" regardless of which systemPrompt shape we use. See
   * src/server/planetChat.ts for the workaround surface.
   */
  settingSources?: ('user' | 'project' | 'local')[]
  /**
   * If true, log the SDK's `system/init` payload (slash_commands, tools,
   * model, etc.) to the Fastify logger the first time the session sees it.
   * Useful for inspecting what the Anthropic SDK actually exposes for a
   * given options shape — leave off for production traffic.
   */
  logSystemInit?: boolean
}

const RUNTIME_NAMESPACE = 'ay_runtime'
const SCRIPTS_NAMESPACE = 'ay_scripts'
const CLARIFICATION_TOOL_NAME = `mcp__${RUNTIME_NAMESPACE}__request_clarification`

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

  /**
   * Build the exact options object that would be passed to the SDK's
   * `query()`. Pure — does NOT mutate Session state or start the query.
   * Used both by `start()` and by smoke tests that want to verify the
   * agent's catalog without burning API calls.
   */
  buildSdkOptions(): {
    mcpServers: Record<string, McpServerConfig>
    tools: string[] | { type: 'preset'; preset: 'claude_code' }
    permissionMode: 'bypassPermissions'
    allowDangerouslySkipPermissions: true
    allowedTools?: string[]
    persistSession: false
    settingSources: ('user' | 'project' | 'local')[]
    cwd?: string
    agents?: Record<string, { description: string; prompt: string; tools?: string[] }>
    agent?: string
    model?: string
  } {
    // Always wire request_clarification under ay_runtime.
    const clarificationTool = createClarificationTool(this) as AnyTool
    const runtimeTools: AnyTool[] = [clarificationTool, ...(this.opts.runtimeTools ?? [])]
    const runtimeMcp = createSdkMcpServer({
      name: RUNTIME_NAMESPACE,
      tools: runtimeTools,
      alwaysLoad: true,
    })

    const mcpServers: Record<string, McpServerConfig> = {
      [RUNTIME_NAMESPACE]: runtimeMcp,
    }

    if (this.opts.scriptTools && this.opts.scriptTools.length > 0) {
      mcpServers[SCRIPTS_NAMESPACE] = createSdkMcpServer({
        name: SCRIPTS_NAMESPACE,
        tools: this.opts.scriptTools,
        alwaysLoad: true,
      })
    }

    if (this.opts.mcpServerConfigs) {
      for (const [name, cfg] of Object.entries(this.opts.mcpServerConfigs)) {
        if (name === RUNTIME_NAMESPACE || name === SCRIPTS_NAMESPACE) continue
        mcpServers[name] = cfg
      }
    }

    const useClaudeCode = this.opts.toolPreset === 'claude_code'
    const tools = useClaudeCode
      ? ({ type: 'preset', preset: 'claude_code' } as const)
      : []

    // MCP tools we always wire — agents must be able to call these regardless of
    // the user's allowedTools list, otherwise drones can't request clarifications,
    // call their attached scripts, or (for leaders) assign tasks / mark nodes complete.
    const runtimeMcpToolNames: string[] = [
      CLARIFICATION_TOOL_NAME,
      ...runtimeTools.slice(1).map((t) => `mcp__${RUNTIME_NAMESPACE}__${t.name}`),
      ...(this.opts.scriptTools ?? []).map((t) => `mcp__${SCRIPTS_NAMESPACE}__${t.name}`),
    ]

    // AgentDefinition.tools is the agent's COMPLETE catalog (SDK contract: "If
    // omitted, inherits all tools from parent"). So when the user narrows via
    // allowedTools, we union with the runtime MCP names — otherwise the drone
    // would lose request_clarification and its scripts.
    let agentToolsForDef: string[] | undefined
    if (useClaudeCode) {
      agentToolsForDef = this.opts.allowedTools
        ? [...this.opts.allowedTools, ...runtimeMcpToolNames]
        : undefined // undefined = inherit full preset + all MCPs from parent
    } else {
      // No Claude Code preset → only MCP tools are available.
      agentToolsForDef = runtimeMcpToolNames
    }

    // Top-level allowedTools is for auto-approval under the standard permission
    // gate; with bypassPermissions + allowDangerouslySkipPermissions it's moot,
    // but we still set it for clarity and to match the agent definition's catalog.
    const allowedTools = agentToolsForDef

    return {
      mcpServers,
      tools,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      ...(allowedTools ? { allowedTools } : {}),
      persistSession: false,
      settingSources: this.opts.settingSources ?? [],
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
    }
  }

  start(): void {
    if (this.q) throw new Error('Session already started')
    this.q = query({
      prompt: this.inputQueue,
      // The cast is necessary because buildSdkOptions returns a precise shape,
      // while the SDK's Options type is broader.
      options: this.buildSdkOptions() as never,
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
    } else if (msg.type === 'system' && this.opts.logSystemInit) {
      // The SDK opens each session with a system message whose subtype is
      // 'init' — it lists slash_commands, tools, model, etc. that the SDK
      // has actually loaded for this session. We dump it to a file so we
      // can compare against what we *expected* to be available (built-in
      // /help, /clear, /mcp, etc.) without needing access to the dev
      // server's stderr. One write per session, never on chat hot paths.
      const anyMsg = msg as unknown as { subtype?: string }
      if (anyMsg.subtype === 'init') {
        try {
          const dir = path.resolve(process.cwd(), 'debug')
          mkdirSync(dir, { recursive: true })
          const line =
            `\n===== ${new Date().toISOString()} session=${this.id} =====\n` +
            JSON.stringify(msg, null, 2) +
            '\n'
          appendFileSync(path.join(dir, 'system-init.log'), line, 'utf8')
        } catch {
          // Diagnostic logging must never break a session.
        }
      }
    }
    // Other message types (user echo, tool_result, partial, non-init system)
    // are ignored for the chat surface.
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
    await this.consumePromise?.catch((err) => {
      // consume() already catches SDK iteration errors and emits a system
      // message + 'failed' state, so reaching this branch means an
      // unexpected throw — surface it instead of swallowing.
      const text = err instanceof Error ? err.message : String(err)
      this.emitEvent({
        type: 'message',
        agentRunId: this.id,
        message: { role: 'system', text: `[close error] ${text}`, timestamp: Date.now() },
      })
    })
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
