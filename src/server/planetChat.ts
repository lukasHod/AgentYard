import type { FastifyBaseLogger } from 'fastify'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { getDb } from './db.js'
import { getPlanet } from './planets.js'
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

function loadHistory(planetId: number): PersistedChatMessage[] {
  const rows = getDb()
    .prepare(
      'SELECT role, content, timestamp FROM planet_chat_messages WHERE planet_id = ? ORDER BY id ASC',
    )
    .all(planetId) as ChatMessageRow[]
  return rows.map((r) => ({ role: r.role, content: r.content, timestamp: r.timestamp }))
}

function appendHistory(planetId: number, msg: PersistedChatMessage): void {
  getDb()
    .prepare(
      'INSERT INTO planet_chat_messages (planet_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
    )
    .run(planetId, msg.role, msg.content, msg.timestamp)
}

function clearHistory(planetId: number): void {
  getDb().prepare('DELETE FROM planet_chat_messages WHERE planet_id = ?').run(planetId)
}

function buildPlanetChatLabel(planetId: number): string {
  return `planet:${planetId}:chat`
}

function buildSystemPrompt(opts: {
  planetName: string
  projectPath: string
  history: PersistedChatMessage[]
}): string {
  const base = [
    `You are the AgentYard planet-chat assistant for the project "${opts.planetName}".`,
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
  return `${base}\n\n## Prior conversation\nThe user has chatted with you before on this planet. Treat this as already said — do not repeat the greeting.\n\n${transcript}`
}

export interface PlanetChatDeps {
  manager: SessionManager
  io: TypedIOServer
  runState: RunRegistry
  log: FastifyBaseLogger
}

/**
 * Owns the long-lived planet-chat session per planet. Persists transcripts to
 * SQLite, lazily spawns the Claude session on demand, replays history as
 * system-prompt context on restart, and tears the session down on planet
 * deletion. Listens to SessionManager events for sessions it owns and
 * persists every emitted user/assistant message.
 */
export class PlanetChatRegistry {
  /** planetId → live session id. Empty until the user opens chat for that planet. */
  private sessionByPlanet = new Map<number, string>()
  /** sessionId → planetId reverse lookup, used by event listener. */
  private planetBySession = new Map<string, number>()

  constructor(private deps: PlanetChatDeps) {
    deps.manager.on('event', (ev: SessionEvent) => this.onSessionEvent(ev))
  }

  /**
   * Replay persisted chat transcripts to a freshly connected client. Called
   * during the socket `connection` handler so a new browser tab sees prior
   * messages even if the session hasn't been opened yet this server boot.
   *
   * We emit `session:added` for the live session (if any) AND replay history
   * under that session id, OR under a stable placeholder id when no live
   * session exists yet. The client's FocusedPanel does its own lookup by
   * label so a placeholder id wouldn't actually match — we only replay for
   * live sessions on socket connect.
   */
  catchUpSocket(socket: TypedSocket): void {
    for (const [planetId, sessionId] of this.sessionByPlanet) {
      const history = loadHistory(planetId)
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
   * Get an existing planet-chat session or spawn a new one. The new session
   * is seeded with persisted transcript as system-prompt context AND those
   * historical messages are replayed back to all sockets as `agent:message`
   * events so the UI shows the full conversation immediately.
   */
  openChat(planetId: number): Session {
    const existingId = this.sessionByPlanet.get(planetId)
    if (existingId) {
      const s = this.deps.manager.get(existingId)
      if (s) return s
      // Stale entry — session was closed under us. Fall through to respawn.
      this.sessionByPlanet.delete(planetId)
      this.planetBySession.delete(existingId)
    }

    const planet = getPlanet(planetId)
    if (!planet) throw new Error(`Planet ${planetId} not found`)

    const history = loadHistory(planetId)
    const systemPrompt = buildSystemPrompt({
      planetName: planet.name,
      projectPath: planet.projectPath,
      history,
    })

    const startFeatureTool = createStartFeatureTool({
      planetId,
      manager: this.deps.manager,
      io: this.deps.io,
      runState: this.deps.runState,
      log: this.deps.log,
    }) as AnyTool

    const session = this.deps.manager.spawn({
      role: 'free',
      label: buildPlanetChatLabel(planetId),
      systemPrompt,
      cwd: planet.projectPath,
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
      // or .claude/commands/help.md inside the planet's project.
      settingSources: ['user', 'project'],
    })
    this.sessionByPlanet.set(planetId, session.id)
    this.planetBySession.set(session.id, planetId)

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

  /** Find the live session descriptor for a planet, if one exists. */
  describe(planetId: number): SessionDescriptor | undefined {
    const sid = this.sessionByPlanet.get(planetId)
    if (!sid) return undefined
    const s = this.deps.manager.get(sid)
    return s ? this.deps.manager.describe(s) : undefined
  }

  /** Close + forget the chat session and drop all persisted history. */
  async deleteForPlanet(planetId: number): Promise<void> {
    const sid = this.sessionByPlanet.get(planetId)
    if (sid) {
      this.sessionByPlanet.delete(planetId)
      this.planetBySession.delete(sid)
      await this.deps.manager.destroy(sid)
    }
    clearHistory(planetId)
  }

  private onSessionEvent(ev: SessionEvent): void {
    const planetId = this.planetBySession.get(ev.agentRunId)
    if (planetId === undefined) return
    if (ev.type === 'message') {
      appendHistory(planetId, {
        role: ev.message.role,
        content: ev.message.text,
        timestamp: ev.message.timestamp,
      })
    } else if (ev.type === 'closed') {
      // The Claude SDK closed under us (e.g. model error). Drop the mapping
      // so the next openChat() respawns fresh — but keep persisted history.
      this.sessionByPlanet.delete(planetId)
      this.planetBySession.delete(ev.agentRunId)
    }
  }
}

export { buildPlanetChatLabel }
