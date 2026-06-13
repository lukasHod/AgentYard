import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { AgentCapabilities, AgentKind } from '../../core/plugins.js'
import { CLAUDE_SDK_CAPABILITIES } from './adapters/claudeSdk.js'
import { Session, type SessionEvent, type SessionOptions } from './Session.js'

export interface SessionDescriptor {
  id: string
  role: Session['role']
  label?: string
  state: Session['state']
  /** Always 'claude-sdk' until additional adapters land. Wire-compatible
   * addition — older clients ignore it. */
  agentKind: AgentKind
  capabilities: AgentCapabilities
}

/**
 * Tracks active Session instances and re-broadcasts their events on a
 * single emitter. Per-Phase 2 the manager is in-memory only; persistent
 * agent-run records land in SQLite in later phases.
 */
export class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>()

  spawn(opts: Omit<SessionOptions, 'id'> & { id?: string }): Session {
    const id = opts.id ?? `agent-${randomUUID().slice(0, 8)}`
    if (this.sessions.has(id)) {
      throw new Error(`Session ${id} already exists`)
    }
    const session = new Session({ ...opts, id })

    session.on('event', (ev: SessionEvent) => {
      this.emit('event', ev)
      if (ev.type === 'closed') {
        this.sessions.delete(id)
        this.emit('session:removed', { id })
      }
    })

    this.sessions.set(id, session)
    this.emit('session:added', this.describe(session))
    session.start()
    return session
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  /** Find a session by role label (e.g. "implementer"). First match wins. */
  findByLabel(label: string): Session | undefined {
    for (const s of this.sessions.values()) {
      if (s.opts.label === label) return s
    }
    return undefined
  }

  list(): Session[] {
    return Array.from(this.sessions.values())
  }

  describe(s: Session): SessionDescriptor {
    return {
      id: s.id,
      role: s.role,
      label: s.opts.label,
      state: s.state,
      agentKind: 'claude-sdk',
      capabilities: CLAUDE_SDK_CAPABILITIES,
    }
  }

  describeAll(): SessionDescriptor[] {
    return this.list().map((s) => this.describe(s))
  }

  async destroy(id: string): Promise<void> {
    const s = this.sessions.get(id)
    if (!s) return
    await s.close()
    // The 'closed' event handler removes it from the map.
  }

  async destroyAll(): Promise<void> {
    await Promise.all(this.list().map((s) => s.close()))
  }
}
