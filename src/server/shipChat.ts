import type { FastifyBaseLogger } from 'fastify'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { getDb } from './db.js'
import { getShip } from './ships.js'
import type { RunRegistry } from './runState.js'
import type { Session, SessionEvent } from './runtime/Session.js'
import type { SessionDescriptor, SessionManager } from './runtime/SessionManager.js'
import { createStartFeatureTool } from './runtime/tools/startFeature.js'
import type { TypedIOServer, TypedSocket } from './socketTypes.js'

type AnyTool = SdkMcpToolDefinition<any>

export interface PersistedChatMessage {
  role: 'assistant' | 'user' | 'system'
  content: string
  timestamp: number
}

interface ChatMessageRow {
  role: 'assistant' | 'user' | 'system'
  content: string
  timestamp: number
}

function loadHistory(shipId: number): PersistedChatMessage[] {
  const rows = getDb()
    .prepare(
      'SELECT role, content, timestamp FROM ship_chat_messages WHERE ship_id = ? ORDER BY id ASC',
    )
    .all(shipId) as ChatMessageRow[]
  return rows.map((r) => ({ role: r.role, content: r.content, timestamp: r.timestamp }))
}

function appendHistory(shipId: number, msg: PersistedChatMessage): void {
  getDb()
    .prepare(
      'INSERT INTO ship_chat_messages (ship_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
    )
    .run(shipId, msg.role, msg.content, msg.timestamp)
}

function clearHistory(shipId: number): void {
  getDb().prepare('DELETE FROM ship_chat_messages WHERE ship_id = ?').run(shipId)
}

function buildShipChatLabel(shipId: number): string {
  return `ship:${shipId}:chat`
}

function buildSystemPrompt(opts: {
  shipName: string
  projectPath: string
  history: PersistedChatMessage[]
}): string {
  const base = [
    `You are the AgentYard ship-chat assistant for the project "${opts.shipName}".`,
    `Working directory: ${opts.projectPath}. You have the full Claude Code toolset (Read, Edit, Write, Glob, Grep, Bash, etc.) — use it freely to explore and modify the project.`,
    '',
    'Two modes of use:',
    '1. Q&A — the user asks questions about the project and you answer using the tools to inspect the code. Do not edit files unless the user clearly wants edits.',
    '2. Feature creation — when the user wants you to BUILD something larger (a new feature, a refactor that touches many files, etc.), prefer calling the `start_feature` tool. It spawns a worktree + workflow that runs the build for them in isolation. Confirm the feature name and task wording before calling.',
    '',
    'Style: terse, direct, no preamble. When you take an action, say what you did in one sentence. When in doubt about scope, ask one targeted question via `request_clarification`.',
  ].join('\n')

  if (opts.history.length === 0) return base

  // Restore prior-session context after a server restart by replaying the
  // transcript verbatim into the system prompt. Trimmed to last N turns so
  // the prompt doesn't grow unbounded.
  const MAX_REPLAYED = 40
  const slice = opts.history.slice(-MAX_REPLAYED)
  const transcript = slice
    .map((m) => {
      const tag = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : 'system'
      return `<${tag}>\n${m.content}\n</${tag}>`
    })
    .join('\n\n')
  return `${base}\n\n## Prior conversation\nThe user has chatted with you before on this ship. Treat this as already said — do not repeat the greeting.\n\n${transcript}`
}

export interface ShipChatDeps {
  manager: SessionManager
  io: TypedIOServer
  runState: RunRegistry
  log: FastifyBaseLogger
}

/**
 * Owns the long-lived ship-chat session per ship. Persists transcripts to
 * SQLite, lazily spawns the Claude session on demand, replays history as
 * system-prompt context on restart, and tears the session down on ship
 * deletion. Listens to SessionManager events for sessions it owns and
 * persists every emitted user/assistant message.
 */
export class ShipChatRegistry {
  /** shipId → live session id. Empty until the user opens chat for that ship. */
  private sessionByShip = new Map<number, string>()
  /** sessionId → shipId reverse lookup, used by event listener. */
  private shipBySession = new Map<string, number>()

  constructor(private deps: ShipChatDeps) {
    deps.manager.on('event', (ev: SessionEvent) => this.onSessionEvent(ev))
  }

  /**
   * Replay persisted chat transcripts to a freshly connected client. Called
   * during the socket `connection` handler so a new browser tab sees prior
   * messages even if the session hasn't been opened yet this server boot.
   *
   * We emit `session:added` for the live session (if any) AND replay history
   * under that session id, OR under a stable placeholder id when no live
   * session exists yet. The client's ShipDetailsPanel does its own lookup by
   * label so a placeholder id wouldn't actually match — we only replay for
   * live sessions on socket connect.
   */
  catchUpSocket(socket: TypedSocket): void {
    for (const [shipId, sessionId] of this.sessionByShip) {
      const history = loadHistory(shipId)
      for (const entry of history) {
        socket.emit('agent:message', {
          agentRunId: sessionId,
          role: entry.role,
          content: entry.content,
          timestamp: entry.timestamp,
        })
      }
    }
  }

  /**
   * Get an existing ship-chat session or spawn a new one. The new session
   * is seeded with persisted transcript as system-prompt context AND those
   * historical messages are replayed back to all sockets as `agent:message`
   * events so the UI shows the full conversation immediately.
   */
  openChat(shipId: number): Session {
    const existingId = this.sessionByShip.get(shipId)
    if (existingId) {
      const s = this.deps.manager.get(existingId)
      if (s) return s
      // Stale entry — session was closed under us. Fall through to respawn.
      this.sessionByShip.delete(shipId)
      this.shipBySession.delete(existingId)
    }

    const ship = getShip(shipId)
    if (!ship) throw new Error(`Ship ${shipId} not found`)

    const history = loadHistory(shipId)
    const systemPrompt = buildSystemPrompt({
      shipName: ship.name,
      projectPath: ship.projectPath,
      history,
    })

    const startFeatureTool = createStartFeatureTool({
      shipId,
      manager: this.deps.manager,
      io: this.deps.io,
      runState: this.deps.runState,
      log: this.deps.log,
    }) as AnyTool

    const session = this.deps.manager.spawn({
      role: 'free',
      label: buildShipChatLabel(shipId),
      systemPrompt,
      cwd: ship.projectPath,
      toolPreset: 'claude_code',
      runtimeTools: [startFeatureTool],
      // Load the user's installed Claude Code config — personal skills,
      // MCP servers, plugins from `~/.claude/` + `<cwd>/.claude/`.
      // Drones/leaders intentionally run with `settingSources: []` so
      // the user's personal config can't bleed into workflow runs.
      //
      // Slash-command surface (verified via system/init dump 2026-05):
      // the SDK exposes /clear, /compact, /context, /init, /review,
      // /security-review, /usage, /insights, /goal, /heapdump,
      // /team-onboarding, /debug, /simplify, /batch, /loop, /schedule,
      // /fewer-permission-prompts, /claude-api, /agent-browser,
      // /find-skills, plus every user-installed skill (e.g.
      // /typescript-best-practices). /help, /mcp, /plugin are CLI-only
      // and are NOT dispatchable — they return "/X isn't available in
      // this environment" no matter what systemPrompt shape we use.
      // To override, drop a custom file in ~/.claude/commands/help.md
      // or .claude/commands/help.md inside the ship's project.
      settingSources: ['user', 'project'],
    })
    this.sessionByShip.set(shipId, session.id)
    this.shipBySession.set(session.id, shipId)

    // Replay persisted history to all connected clients under the new session
    // id so the chat UI shows the conversation immediately on open. The Claude
    // model itself has the same context via the system prompt.
    for (const entry of history) {
      this.deps.io.emit('agent:message', {
        agentRunId: session.id,
        role: entry.role,
        content: entry.content,
        timestamp: entry.timestamp,
      })
    }

    return session
  }

  /** Find the live session descriptor for a ship, if one exists. */
  describe(shipId: number): SessionDescriptor | undefined {
    const sid = this.sessionByShip.get(shipId)
    if (!sid) return undefined
    const s = this.deps.manager.get(sid)
    return s ? this.deps.manager.describe(s) : undefined
  }

  /** Close + forget the chat session and drop all persisted history. */
  async deleteForShip(shipId: number): Promise<void> {
    const sid = this.sessionByShip.get(shipId)
    if (sid) {
      this.sessionByShip.delete(shipId)
      this.shipBySession.delete(sid)
      await this.deps.manager.destroy(sid)
    }
    clearHistory(shipId)
  }

  private onSessionEvent(ev: SessionEvent): void {
    const shipId = this.shipBySession.get(ev.agentRunId)
    if (shipId === undefined) return
    if (ev.type === 'message') {
      appendHistory(shipId, {
        role: ev.message.role,
        content: ev.message.text,
        timestamp: ev.message.timestamp,
      })
    } else if (ev.type === 'closed') {
      // The Claude SDK closed under us (e.g. model error). Drop the mapping
      // so the next openChat() respawns fresh — but keep persisted history.
      this.sessionByShip.delete(shipId)
      this.shipBySession.delete(ev.agentRunId)
    }
  }
}

export { buildShipChatLabel }
