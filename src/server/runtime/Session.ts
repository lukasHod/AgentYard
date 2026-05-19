import { EventEmitter } from 'node:events'
import {
  createSdkMcpServer,
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentState } from '../../core/types.js'
import { AsyncQueue } from './AsyncQueue.js'
import {
  createClarificationTool,
  type ClarificationGateway,
  type ClarificationRequest,
} from './tools/requestClarification.js'

export interface SessionTextMessage {
  role: 'assistant' | 'user' | 'system'
  text: string
  timestamp: number
}

export type SessionEvent =
  | { type: 'message'; message: SessionTextMessage }
  | { type: 'state'; state: AgentState }
  | { type: 'clarification:requested'; req: ClarificationRequest }
  | { type: 'clarification:resolved'; id: string }
  | { type: 'closed' }

export interface SessionOptions {
  systemPrompt?: string
  model?: string
}

const CLARIFICATION_TOOL = 'mcp__agentyard__request_clarification'

/**
 * One Claude Agent SDK session. Wraps query() with a streamable input
 * channel, an event emitter for SDK output, and a clarification gateway
 * that lets the agent ask the user questions mid-turn.
 *
 * For Phase 1 only one Session exists at a time; multi-session orchestration
 * comes in Phase 2 via SessionManager.
 */
export class Session extends EventEmitter implements ClarificationGateway {
  private inputQueue = new AsyncQueue<SDKUserMessage>()
  private q?: Query
  private pendingClarifications = new Map<string, (answer: string) => void>()
  private _state: AgentState = 'idle'
  private consumePromise?: Promise<void>

  constructor(public readonly opts: SessionOptions = {}) {
    super()
  }

  get state(): AgentState {
    return this._state
  }

  start(): void {
    if (this.q) throw new Error('Session already started')

    const clarificationTool = createClarificationTool(this)
    const mcp = createSdkMcpServer({
      name: 'agentyard',
      tools: [clarificationTool],
      alwaysLoad: true,
    })

    this.q = query({
      prompt: this.inputQueue,
      options: {
        mcpServers: { agentyard: mcp },
        tools: [], // no built-in Claude Code tools in Phase 1
        allowedTools: [CLARIFICATION_TOOL],
        persistSession: false,
        settingSources: [], // ignore user/project settings; we want a clean session
        ...(this.opts.systemPrompt
          ? {
              agents: {
                'agentyard-leader': {
                  description: 'AgentYard chat session',
                  prompt: this.opts.systemPrompt,
                  tools: [CLARIFICATION_TOOL],
                },
              },
              agent: 'agentyard-leader',
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
        message: { role: 'system', text: `[error] ${text}`, timestamp: Date.now() },
      })
      this.setState('failed')
    } finally {
      this.emitEvent({ type: 'closed' })
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
          message: { role: 'assistant', text, timestamp: Date.now() },
        })
      }
      if (toolUseCount > 0) {
        this.setState('tool_running')
      } else {
        this.setState('thinking')
      }
    } else if (msg.type === 'result') {
      // 'result' is fired at the end of an agentic turn — back to idle.
      this.setState('idle')
    } else if (msg.type === 'system') {
      // System init / config — ignore for chat display.
    }
    // Other message types (user echo, tool_result, etc.) are not surfaced
    // in the chat UI for Phase 1.
  }

  /** Push a user message into the agent's input stream. */
  sendUserMessage(text: string): void {
    if (!this.q) throw new Error('Session not started')
    this.emitEvent({
      type: 'message',
      message: { role: 'user', text, timestamp: Date.now() },
    })
    this.inputQueue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    })
    this.setState('thinking')
  }

  /** Resolve a pending request_clarification call with the user's answer. */
  resolveClarification(id: string, answer: string): boolean {
    const resolver = this.pendingClarifications.get(id)
    if (!resolver) return false
    this.pendingClarifications.delete(id)
    resolver(answer)
    this.emitEvent({
      type: 'message',
      message: { role: 'user', text: answer, timestamp: Date.now() },
    })
    this.emitEvent({ type: 'clarification:resolved', id })
    this.setState('thinking')
    return true
  }

  /** ClarificationGateway implementation — called by the request_clarification tool. */
  request(req: ClarificationRequest): Promise<string> {
    return new Promise<string>((resolve) => {
      this.pendingClarifications.set(req.id, resolve)
      this.setState('awaiting_clarification')
      this.emitEvent({ type: 'clarification:requested', req })
    })
  }

  async close(): Promise<void> {
    this.q?.close()
    this.inputQueue.close()
    await this.consumePromise?.catch(() => {})
  }

  private setState(state: AgentState): void {
    if (this._state === state) return
    this._state = state
    this.emitEvent({ type: 'state', state })
  }

  private emitEvent(ev: SessionEvent): void {
    this.emit('event', ev)
  }
}
