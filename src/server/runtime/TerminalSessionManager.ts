import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type {
  TerminalProfileId,
  TerminalSessionDescriptor,
  TerminalStartRequest,
} from '../../core/types.js'
import { spawnPty, type PtyProcess } from './runtimes/ptyRuntime.js'
import {
  appendTerminalChunk,
  createTerminalSession,
  deleteTerminalSession,
  getTerminalSession,
  getTerminalSessionEnv,
  listTerminalChunks,
  listTerminalSessions,
  markRunningTerminalsRuntimeLost,
  updateTerminalSession,
} from '../terminalStore.js'

export type TerminalManagerEvent =
  | { type: 'session:added'; session: TerminalSessionDescriptor }
  | { type: 'session:update'; session: TerminalSessionDescriptor }
  | { type: 'session:removed'; sessionId: string }
  | { type: 'data'; sessionId: string; data: string; timestamp: number }
  | { type: 'exit'; sessionId: string; code: number | null; signal: number | null; timestamp: number }

interface LiveTerminal {
  session: TerminalSessionDescriptor
  process: PtyProcess
}

interface TerminalSessionManagerOptions {
  spawn?: typeof spawnPty
  reconcileStaleSessions?: boolean
}

export class TerminalSessionManager extends EventEmitter {
  private live = new Map<string, LiveTerminal>()
  private killRequested = new Set<string>()
  private readonly spawn: typeof spawnPty

  constructor(opts: TerminalSessionManagerOptions = {}) {
    super()
    this.spawn = opts.spawn ?? spawnPty
    if (opts.reconcileStaleSessions !== false) markRunningTerminalsRuntimeLost()
  }

  list(): TerminalSessionDescriptor[] {
    const persisted = listTerminalSessions()
    return persisted.map((session) => {
      const live = this.live.get(session.id)
      return live?.session ?? session
    })
  }

  get(id: string): TerminalSessionDescriptor | undefined {
    return this.live.get(id)?.session ?? getTerminalSession(id)
  }

  snapshot(id: string): { data: string; state: TerminalSessionDescriptor['state'] } | null {
    const live = this.live.get(id)
    if (live) {
      return {
        data: listTerminalChunks(id, { limit: 500 }).join('') || live.process.buffer(),
        state: live.session.state,
      }
    }
    const session = getTerminalSession(id)
    if (!session) return null
    return { data: listTerminalChunks(id, { limit: 500 }).join(''), state: session.state }
  }

  start(req: TerminalStartRequest): TerminalSessionDescriptor {
    const sessionId = req.sessionId ?? `term-${randomUUID().slice(0, 8)}`
    if (this.live.has(sessionId) || getTerminalSession(sessionId)) {
      throw new Error(`terminal session ${sessionId} already exists`)
    }
    const plan = resolveTerminalPlan(req)
    const env = injectAgentYardEnv(plan.env, {
      sessionId,
      planetId: req.planetId,
      featureId: req.featureId,
      workflowRunId: req.workflowRunId,
      nodeRunId: req.nodeRunId,
    })
    const proc = this.spawn({
      argv: plan.argv,
      cwd: req.cwd,
      env,
      cols: req.cols,
      rows: req.rows,
    })
    const session = createTerminalSession({
      id: sessionId,
      profileId: req.profileId,
      planetId: req.planetId,
      featureId: req.featureId,
      workflowRunId: req.workflowRunId,
      nodeRunId: req.nodeRunId,
      agentSessionId: req.agentSessionId,
      role: req.role,
      cwd: req.cwd,
      argv: plan.argv,
      env,
      pid: proc.pid,
    })
    const live: LiveTerminal = { session, process: proc }
    this.live.set(sessionId, live)
    this.bindProcess(sessionId, live)

    this.emitTerminal({ type: 'session:added', session })
    return session
  }

  write(id: string, data: string): boolean {
    const live = this.live.get(id)
    if (!live) return false
    live.process.write(data)
    return true
  }

  resize(id: string, cols: number, rows: number): boolean {
    const live = this.live.get(id)
    if (!live || !Number.isFinite(cols) || !Number.isFinite(rows)) return false
    live.process.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)))
    return true
  }

  async kill(id: string): Promise<boolean> {
    const live = this.live.get(id)
    if (!live) return false
    this.killRequested.add(id)
    await live.process.kill()
    const timestamp = Date.now()
    const updated =
      updateTerminalSession(id, {
        state: 'killed',
        pid: null,
        lastExitedAt: timestamp,
      }) ?? live.session
    live.session = updated
    this.live.delete(id)
    this.emitTerminal({ type: 'session:update', session: updated })
    return true
  }

  restart(id: string): TerminalSessionDescriptor | undefined {
    if (this.live.has(id)) return undefined
    const existing = getTerminalSession(id)
    if (!existing) return undefined
    return this.restartInPlace(id, existing, existing.argv)
  }

  /** Restart a dead Claude CLI session with `--continue` to resume its conversation. */
  resume(id: string): TerminalSessionDescriptor | undefined {
    if (this.live.has(id)) return undefined
    const existing = getTerminalSession(id)
    if (!existing) return undefined
    const argv =
      isClaudeCli(existing.argv) && !existing.argv.includes('--continue')
        ? [...existing.argv, '--continue']
        : existing.argv
    return this.restartInPlace(id, existing, argv)
  }

  /**
   * Restart a dead session with a handoff context injected via
   * `--append-system-prompt` (Claude CLI) or plain restart (other runtimes).
   * The stored argv is not modified — the flag is runtime-only.
   */
  restartWithContext(id: string, markdownContext: string): TerminalSessionDescriptor | undefined {
    if (this.live.has(id)) return undefined
    const existing = getTerminalSession(id)
    if (!existing) return undefined
    const argv = isClaudeCli(existing.argv)
      ? [...existing.argv, '--append-system-prompt', markdownContext]
      : existing.argv
    return this.restartInPlace(id, existing, argv)
  }

  /**
   * Create a NEW shell terminal session in the same working directory and
   * feature context as `sourceId`. Returns the new session descriptor.
   */
  openShellFromSession(sourceId: string): TerminalSessionDescriptor {
    const source = this.live.get(sourceId)?.session ?? getTerminalSession(sourceId)
    if (!source) throw new Error(`terminal session ${sourceId} not found`)
    const profileId: TerminalProfileId = process.platform === 'win32' ? 'powershell' : 'unix-shell'
    return this.start({
      profileId,
      cwd: source.cwd ?? undefined,
      planetId: source.planetId ?? undefined,
      featureId: source.featureId ?? undefined,
      workflowRunId: source.workflowRunId ?? undefined,
      nodeRunId: source.nodeRunId ?? undefined,
      agentSessionId: source.agentSessionId ?? undefined,
      role: source.role ?? undefined,
    })
  }

  private restartInPlace(
    id: string,
    existing: TerminalSessionDescriptor,
    argv: string[],
  ): TerminalSessionDescriptor {
    const env = injectAgentYardEnv(getTerminalSessionEnv(id), {
      sessionId: existing.id,
      planetId: existing.planetId ?? undefined,
      featureId: existing.featureId ?? undefined,
      workflowRunId: existing.workflowRunId ?? undefined,
      nodeRunId: existing.nodeRunId ?? undefined,
    })
    const proc = this.spawn({ argv, cwd: existing.cwd ?? undefined, env })
    const restarted =
      updateTerminalSession(id, {
        state: 'running',
        exitCode: null,
        exitSignal: null,
        pid: proc.pid,
        lastStartedAt: Date.now(),
        lastExitedAt: null,
      }) ?? existing
    const live: LiveTerminal = { session: restarted, process: proc }
    this.live.set(id, live)
    this.bindProcess(id, live)
    this.emitTerminal({ type: 'session:update', session: restarted })
    return restarted
  }

  /**
   * Kill the PTY (if alive), then remove the descriptor and its transcript
   * from the database. Use this when the user explicitly wants the terminal
   * gone — not as the normal "process exited" path. Returns true if a row
   * was removed.
   */
  async delete(id: string): Promise<boolean> {
    if (this.live.has(id)) {
      await this.kill(id)
    }
    const existed = deleteTerminalSession(id)
    if (existed) this.emitTerminal({ type: 'session:removed', sessionId: id })
    return existed
  }

  async destroyAll(): Promise<void> {
    await Promise.all(Array.from(this.live.keys()).map((id) => this.kill(id)))
  }

  private emitTerminal(event: TerminalManagerEvent): void {
    this.emit('terminal:event', event)
  }

  private bindProcess(sessionId: string, live: LiveTerminal): void {
    live.process.events.on('data', (data: string) => {
      const timestamp = Date.now()
      appendTerminalChunk(sessionId, data, timestamp)
      this.emitTerminal({ type: 'data', sessionId, data, timestamp })
    })

    live.process.events.on('exit', ({ code, signal }: { code: number | null; signal: number | null }) => {
      this.live.delete(sessionId)
      const timestamp = Date.now()
      const wasKilled = this.killRequested.delete(sessionId)
      const updated =
        updateTerminalSession(sessionId, {
          state: wasKilled ? 'killed' : code === 0 ? 'exited' : 'failed',
          exitCode: code,
          exitSignal: signal,
          pid: null,
          lastExitedAt: timestamp,
        }) ?? live.session
      live.session = updated
      this.emitTerminal({ type: 'session:update', session: updated })
      this.emitTerminal({ type: 'exit', sessionId, code, signal, timestamp })
    })
  }
}

function isClaudeCli(argv: string[]): boolean {
  const bin = argv[0] ?? ''
  return bin === 'claude' || bin.endsWith('/claude') || bin.endsWith('\\claude') || bin.endsWith('\\claude.exe')
}

function resolveTerminalPlan(req: TerminalStartRequest): { argv: string[]; env?: Record<string, string> } {
  if (req.profileId === 'custom') {
    if (!req.argv || req.argv.length === 0 || !req.argv[0]) {
      throw new Error('custom terminal profile requires a non-empty argv')
    }
    return { argv: req.argv, env: req.env }
  }
  // Allow an explicit argv to override the profile default — used when the
  // workflow engine needs to inject flags (e.g. --append-system-prompt) while
  // still tagging the session with the correct profile for the UI.
  const argv = req.argv && req.argv.length > 0 ? req.argv : defaultArgv(req.profileId)
  return { argv, env: req.env }
}

function defaultArgv(profileId: TerminalProfileId): string[] {
  switch (profileId) {
    case 'claude-cli':
      return ['claude']
    case 'codex-cli':
      return ['codex']
    case 'powershell':
      return ['powershell.exe']
    case 'unix-shell':
      return [process.env.SHELL || 'sh']
    case 'custom':
      throw new Error('custom terminal profile requires explicit argv')
    default: {
      const exhaustive: never = profileId
      throw new Error(`unsupported terminal profile: ${exhaustive}`)
    }
  }
}

function injectAgentYardEnv(
  env: Record<string, string> | undefined,
  ctx: {
    sessionId: string
    planetId?: number
    featureId?: number
    workflowRunId?: string
    nodeRunId?: string
  },
): Record<string, string> {
  return {
    ...env,
    AGENTYARD_SESSION_ID: ctx.sessionId,
    ...(ctx.planetId !== undefined ? { AGENTYARD_PLANET_ID: String(ctx.planetId) } : {}),
    ...(ctx.featureId !== undefined ? { AGENTYARD_FEATURE_ID: String(ctx.featureId) } : {}),
    ...(ctx.workflowRunId ? { AGENTYARD_WORKFLOW_RUN_ID: ctx.workflowRunId } : {}),
    ...(ctx.nodeRunId ? { AGENTYARD_NODE_RUN_ID: ctx.nodeRunId } : {}),
    // Bridge URL is set on process.env by the server after it binds to a port.
    // Terminals inherit it so `agentyard ask-user` etc. know where to call.
    ...(process.env.AGENTYARD_BRIDGE_URL
      ? { AGENTYARD_BRIDGE_URL: process.env.AGENTYARD_BRIDGE_URL }
      : {}),
  }
}
