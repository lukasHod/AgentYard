import type { FastifyBaseLogger } from 'fastify'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { getDb } from './db.js'
import { getFeature } from './features.js'
import { getPlanet } from './planets.js'
import type { RunRegistry } from './runState.js'
import type { Session, SessionEvent } from './runtime/Session.js'
import type { SessionDescriptor, SessionManager } from './runtime/SessionManager.js'
import type { TerminalSessionManager } from './runtime/TerminalSessionManager.js'
import { createUpdateFeatureInfoTool } from './runtime/tools/updateFeatureInfo.js'
import { createRunFeatureWorkflowTool } from './runtime/tools/runFeatureWorkflow.js'
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

function loadHistory(featureId: number): PersistedChatMessage[] {
  const rows = getDb()
    .prepare(
      'SELECT role, content, timestamp FROM feature_chat_messages WHERE feature_id = ? ORDER BY id ASC',
    )
    .all(featureId) as ChatMessageRow[]
  return rows.map((r) => ({ role: r.role, content: r.content, timestamp: r.timestamp }))
}

function appendHistory(featureId: number, msg: PersistedChatMessage): void {
  getDb()
    .prepare(
      'INSERT INTO feature_chat_messages (feature_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
    )
    .run(featureId, msg.role, msg.content, msg.timestamp)
}

function appendInterruptedTurnNotice(
  featureId: number,
  history: PersistedChatMessage[],
): PersistedChatMessage[] {
  const last = history.at(-1)
  if (last?.role !== 'user') return history

  const notice: PersistedChatMessage = {
    role: 'system',
    content:
      'The previous message was saved, but the agent did not finish a response before the chat session ended. Please resend it if you still want me to run it.',
    timestamp: Date.now(),
  }
  appendHistory(featureId, notice)
  return [...history, notice]
}

function clearHistory(featureId: number): void {
  getDb().prepare('DELETE FROM feature_chat_messages WHERE feature_id = ?').run(featureId)
}

function buildFeatureChatLabel(featureId: number): string {
  return `feature:${featureId}:chat`
}

function buildSystemPrompt(opts: {
  featureName: string
  planetName: string
  projectPath: string
  featureStatus: string
  history: PersistedChatMessage[]
}): string {
  const base = [
    `You are the AgentYard feature assistant for the feature "${opts.featureName}" on project "${opts.planetName}".`,
    `Working directory: ${opts.projectPath}. You have the full Claude Code toolset.`,
    '',
    `Current status: ${opts.featureStatus}`,
    '',
    'Two things you do:',
    '1. Discuss and explore the feature with the user — answer questions, brainstorm, explore the code.',
    '2. When the user is ready to implement, call `run_workflow` to start the automated build pipeline.',
    '',
    'After your FIRST response to the user, call `update_feature_info` with a short slug name (e.g. "dashboard-redesign"), a human-readable chatName (e.g. "Dashboard Readability Redesign"), and a 1-3 sentence description summarizing what this feature is about. Do this only once.',
    '',
    'Style: terse, direct, no preamble.',
  ].join('\n')

  if (opts.history.length === 0) return base

  const MAX_REPLAYED = 40
  const slice = opts.history.slice(-MAX_REPLAYED)
  const transcript = slice
    .map((m) => {
      const tag = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : 'system'
      return `<${tag}>\n${m.content}\n</${tag}>`
    })
    .join('\n\n')
  return `${base}\n\n## Prior conversation\nThe user has chatted with you before about this feature. Treat this as already said — do not repeat the greeting.\n\n${transcript}`
}

export interface FeatureChatDeps {
  manager: SessionManager
  terminals?: TerminalSessionManager
  io: TypedIOServer
  runState: RunRegistry
  log: FastifyBaseLogger
}

/**
 * Owns the long-lived feature-chat session per feature. Persists transcripts
 * to SQLite, lazily spawns the Claude session on demand, replays history as
 * system-prompt context on restart, and tears the session down on feature
 * deletion. Listens to SessionManager events for sessions it owns and
 * persists every emitted user/assistant message.
 */
export class FeatureChatRegistry {
  /** featureId → live session id. Empty until the user opens chat for that feature. */
  private sessionByFeature = new Map<number, string>()
  /** sessionId → featureId reverse lookup, used by event listener. */
  private featureBySession = new Map<string, number>()

  constructor(private deps: FeatureChatDeps) {
    deps.manager.on('event', (ev: SessionEvent) => this.onSessionEvent(ev))
  }

  /**
   * Replay persisted chat transcripts to a freshly connected client. Called
   * during the socket `connection` handler so a new browser tab sees prior
   * messages even if the session hasn't been opened yet this server boot.
   */
  catchUpSocket(socket: TypedSocket): void {
    for (const [featureId, sessionId] of this.sessionByFeature) {
      const history = loadHistory(featureId)
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
   * Get an existing feature-chat session or spawn a new one. The new session
   * is seeded with persisted transcript as system-prompt context AND those
   * historical messages are replayed back to all sockets as `agent:message`
   * events so the UI shows the full conversation immediately.
   */
  openChat(featureId: number): Session {
    const existingId = this.sessionByFeature.get(featureId)
    if (existingId) {
      const s = this.deps.manager.get(existingId)
      if (s) return s
      // Stale entry — session was closed under us. Fall through to respawn.
      this.sessionByFeature.delete(featureId)
      this.featureBySession.delete(existingId)
    }

    const feature = getFeature(featureId)
    if (!feature) throw new Error(`Feature ${featureId} not found`)

    const planet = getPlanet(feature.planetId)
    if (!planet) throw new Error(`Planet ${feature.planetId} not found`)

    const history = appendInterruptedTurnNotice(featureId, loadHistory(featureId))
    const systemPrompt = buildSystemPrompt({
      featureName: feature.name,
      planetName: planet.name,
      projectPath: planet.projectPath,
      featureStatus: feature.status,
      history,
    })

    const updateFeatureInfoTool = createUpdateFeatureInfoTool({
      featureId,
      io: this.deps.io,
    }) as AnyTool

    const runFeatureWorkflowTool = createRunFeatureWorkflowTool({
      featureId,
      planetId: feature.planetId,
      manager: this.deps.manager,
      terminals: this.deps.terminals,
      io: this.deps.io,
      runState: this.deps.runState,
      log: this.deps.log,
    }) as AnyTool

    const session = this.deps.manager.spawn({
      role: 'free',
      label: buildFeatureChatLabel(featureId),
      systemPrompt,
      cwd: planet.projectPath,
      toolPreset: 'claude_code',
      runtimeTools: [updateFeatureInfoTool, runFeatureWorkflowTool],
      settingSources: ['user', 'project'],
      scope: { featureId, planetId: feature.planetId },
    })
    this.sessionByFeature.set(featureId, session.id)
    this.featureBySession.set(session.id, featureId)

    // Replay persisted history to all connected clients under the new session
    // id so the chat UI shows the conversation immediately on open.
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

  /** Find the live session descriptor for a feature, if one exists. */
  describe(featureId: number): SessionDescriptor | undefined {
    const sid = this.sessionByFeature.get(featureId)
    if (!sid) return undefined
    const s = this.deps.manager.get(sid)
    return s ? this.deps.manager.describe(s) : undefined
  }

  /** Close + forget the chat session and drop all persisted history. */
  async deleteForFeature(featureId: number): Promise<void> {
    const sid = this.sessionByFeature.get(featureId)
    if (sid) {
      this.sessionByFeature.delete(featureId)
      this.featureBySession.delete(sid)
      await this.deps.manager.destroy(sid)
    }
    clearHistory(featureId)
  }

  private onSessionEvent(ev: SessionEvent): void {
    const featureId = this.featureBySession.get(ev.agentRunId)
    if (featureId === undefined) return
    if (ev.type === 'message') {
      appendHistory(featureId, {
        role: ev.message.role,
        content: ev.message.text,
        timestamp: ev.message.timestamp,
      })
    } else if (ev.type === 'closed') {
      // The Claude SDK closed under us (e.g. model error). Drop the mapping
      // so the next openChat() respawns fresh — but keep persisted history.
      this.sessionByFeature.delete(featureId)
      this.featureBySession.delete(ev.agentRunId)
    }
  }
}

export { buildFeatureChatLabel }
