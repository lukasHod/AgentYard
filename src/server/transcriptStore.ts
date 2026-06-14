import type { AgentState } from '../core/types.js'
import type { SessionEvent } from './runtime/Session.js'
import type { SessionDescriptor } from './runtime/SessionManager.js'
import type { TypedIOServer, TypedSocket } from './socketTypes.js'

interface TranscriptEntry {
  role: 'assistant' | 'user' | 'system'
  content: string
  timestamp: number
}

interface PendingClarification {
  id: string
  question: string
}

/**
 * Per-session bookkeeping for socket-side catch-up: transcripts (so newly
 * connecting clients get history), latest state per agent, and outstanding
 * clarification requests. Driven by SessionManager events; consumed when a
 * new socket connects and asks for "where are we now".
 */
export class TranscriptStore {
  private transcripts = new Map<string, TranscriptEntry[]>()
  private pending = new Map<string, Map<string, PendingClarification>>()
  private states = new Map<string, AgentState>()

  constructor(private io: TypedIOServer) {}

  onSessionAdded(desc: SessionDescriptor): void {
    this.states.set(desc.id, desc.state)
    this.transcripts.set(desc.id, [])
    this.pending.set(desc.id, new Map())
    this.io.emit('session:added', desc)
  }

  onSessionRemoved(ev: { id: string }): void {
    this.io.emit('session:removed', ev)
  }

  onSessionEvent(ev: SessionEvent): void {
    const id = ev.agentRunId
    switch (ev.type) {
      case 'message': {
        const entry: TranscriptEntry = {
          role: ev.message.role,
          content: ev.message.text,
          timestamp: ev.message.timestamp,
        }
        this.transcripts.get(id)?.push(entry)
        this.io.emit('agent:message', { agentRunId: id, ...entry })
        break
      }
      case 'state': {
        this.states.set(id, ev.state)
        this.io.emit('agent:state', { agentRunId: id, state: ev.state })
        break
      }
      case 'clarification:requested': {
        this.pending.get(id)?.set(ev.req.id, ev.req)
        this.io.emit('clarification:requested', {
          agentRunId: id,
          toolUseId: ev.req.id,
          question: ev.req.question,
        })
        break
      }
      case 'clarification:resolved': {
        this.pending.get(id)?.delete(ev.id)
        this.io.emit('clarification:resolved', { agentRunId: id, toolUseId: ev.id })
        break
      }
      case 'tool_use': {
        this.io.emit('agent:tool_use', {
          agentRunId: id,
          tool: ev.tool,
          toolUseId: ev.toolUseId,
          input: ev.input,
          timestamp: ev.timestamp,
        })
        break
      }
      case 'tool_result': {
        this.io.emit('agent:tool_result', {
          agentRunId: id,
          tool: ev.tool,
          toolUseId: ev.toolUseId,
          output: ev.output,
          ...(ev.isError !== undefined ? { isError: ev.isError } : {}),
          timestamp: ev.timestamp,
        })
        break
      }
      case 'cost': {
        this.io.emit('agent:cost', {
          agentRunId: id,
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          timestamp: ev.timestamp,
        })
        break
      }
      case 'closed': {
        // Logged at the session-manager layer; we don't surface 'closed' to UI.
        break
      }
    }
  }

  /** Replay everything we have to a freshly-connected client. */
  catchUp(socket: TypedSocket): void {
    for (const [id, transcript] of this.transcripts) {
      for (const entry of transcript) {
        socket.emit('agent:message', { agentRunId: id, ...entry })
      }
      const state = this.states.get(id)
      if (state) socket.emit('agent:state', { agentRunId: id, state })
      const pendings = this.pending.get(id)
      if (pendings) {
        for (const p of pendings.values()) {
          socket.emit('clarification:requested', {
            agentRunId: id,
            toolUseId: p.id,
            question: p.question,
          })
        }
      }
    }
  }

  /** Return transcript entries for a set of session IDs (for handoff serialization). */
  getTranscripts(ids: string[]): Map<string, TranscriptEntry[]> {
    const result = new Map<string, TranscriptEntry[]>()
    for (const id of ids) {
      const entries = this.transcripts.get(id)
      if (entries) result.set(id, [...entries])
    }
    return result
  }

  clear(): void {
    this.transcripts.clear()
    this.pending.clear()
    this.states.clear()
  }
}
