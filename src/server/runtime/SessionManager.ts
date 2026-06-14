import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { AgentCapabilities, AgentKind, AgentRuntimeContext } from '../../core/plugins.js'
import { createRunnerSession, deleteRunnerSession } from '../runStore.js'
import { CLAUDE_SDK_CAPABILITIES, sessionEventToAgentEvent } from './adapters/claudeSdk.js'
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
 * Workflow / chat scope to attach to each session in `runner_sessions`. All
 * fields are optional because not every session has a parent run (free
 * chat) or planet (workflow drones). Pass what you know; the rest stays
 * NULL.
 */
export interface SessionScope {
  runId?: string
  nodeRunId?: string
  featureId?: number
  planetId?: number
}

export type SpawnOptions = Omit<SessionOptions, 'id'> & {
  id?: string
  scope?: SessionScope
}

/**
 * Tracks active Session instances and re-broadcasts their events on a
 * single emitter. Every spawn registers a row in `runner_sessions` and
 * every SessionEvent is translated to an AgentEvent and persisted via
 * the runtime context (Phase 4 — `runner_events` is the source of truth).
 */
export class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>()

  /** When set, every spawn registers in `runner_sessions` and events are
   * persisted via the runtime context. Left null in tests that don't want
   * DB writes. The server constructor wires this in production. */
  private runtimeCtx: AgentRuntimeContext | null = null

  setRuntimeContext(ctx: AgentRuntimeContext): void {
    this.runtimeCtx = ctx
  }

  spawn(opts: SpawnOptions): Session {
    const id = opts.id ?? `agent-${randomUUID().slice(0, 8)}`
    if (this.sessions.has(id)) {
      throw new Error(`Session ${id} already exists`)
    }
    const { scope, ...sessionOpts } = opts
    const session = new Session({ ...sessionOpts, id })

    if (this.runtimeCtx) {
      createRunnerSession({
        id,
        agentKind: 'claude-sdk',
        runtimeKind: 'sdk',
        role: opts.role,
        label: opts.label,
        cwd: opts.cwd,
        runId: scope?.runId,
        nodeRunId: scope?.nodeRunId,
        featureId: scope?.featureId,
        planetId: scope?.planetId,
      })
    }

    session.on('event', (ev: SessionEvent) => {
      this.emit('event', ev)
      // Persist a normalized AgentEvent — the runtime context updates
      // runner_sessions.state in the same transaction.
      if (this.runtimeCtx) {
        if (ev.type === 'closed') {
          this.runtimeCtx.recordEvent(id, {
            type: 'exited',
            code: session.state === 'failed' ? 1 : 0,
            reason: session.state === 'failed' ? 'error_in_process' : undefined,
            ts: Date.now(),
          })
        } else {
          const agentEvent = sessionEventToAgentEvent(ev)
          if (agentEvent) this.runtimeCtx.recordEvent(id, agentEvent)
        }
      }
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
    // The 'closed' event handler removes it from the map. We also drop the
    // runner_sessions row — destroy() is an explicit teardown (e.g. feature
    // delete), distinct from a natural exit which leaves the row for audit.
    if (this.runtimeCtx) deleteRunnerSession(id)
  }

  async destroyAll(): Promise<void> {
    await Promise.all(this.list().map((s) => s.close()))
  }
}
