import { randomUUID } from 'node:crypto'
import type { DB } from './db.js'
import type { SessionManager } from './runtime/SessionManager.js'
import type { SessionEvent } from './runtime/Session.js'
import type { TypedIOServer, TypedSocket } from './socketTypes.js'
import type { PendingQuestion } from '../core/types.js'

interface DbRow {
  id: string
  agent_session_id: string
  tool_use_id: string
  planet_id: number | null
  feature_id: number | null
  workflow_run_id: string | null
  node_run_id: string | null
  question: string
  state: string
  created_at: number
  answered_at: number | null
  answer: string | null
}

function rowToQuestion(r: DbRow): PendingQuestion {
  return {
    id: r.id,
    agentSessionId: r.agent_session_id,
    toolUseId: r.tool_use_id,
    planetId: r.planet_id,
    featureId: r.feature_id,
    workflowRunId: r.workflow_run_id,
    nodeRunId: r.node_run_id,
    question: r.question,
    state: r.state as PendingQuestion['state'],
    createdAt: r.created_at,
    answeredAt: r.answered_at,
    answer: r.answer,
  }
}

/**
 * Persists pending clarification questions durably in SQLite so they survive
 * server restart. Hooks into SessionManager events to auto-create records when
 * a session invokes request_clarification, and auto-marks them answered when
 * the session resolves. The `question:answer` socket event routes answers
 * through this store so it is always the authoritative state.
 */
export class PendingQuestionStore {
  /** questionId → resolve callback for bridge long-polls waiting on an answer. */
  private answerWaiters = new Map<string, (answer: string) => void>()

  constructor(
    private db: DB,
    private io: TypedIOServer,
    private manager: SessionManager,
  ) {}

  /** Called from server.ts for every SessionManager event — mirrors TranscriptStore's pattern. */
  onSessionEvent(agentRunId: string, ev: SessionEvent): void {
    switch (ev.type) {
      case 'clarification:requested': {
        const ctx = this.lookupSessionContext(agentRunId)
        const q = this.createRecord({
          agentSessionId: agentRunId,
          toolUseId: ev.req.id,
          question: ev.req.question,
          ...ctx,
        })
        this.io.emit('question:created', q)
        break
      }
      case 'clarification:resolved': {
        // Fallback for the legacy clarification:reply path that bypasses question:answer.
        const row = this.db
          .prepare(
            `SELECT id FROM pending_questions
             WHERE agent_session_id=? AND tool_use_id=? AND state='pending'`,
          )
          .get(agentRunId, ev.id) as { id: string } | undefined
        if (row) {
          const now = Date.now()
          this.db
            .prepare(
              `UPDATE pending_questions SET state='answered', answered_at=?
               WHERE id=?`,
            )
            .run(now, row.id)
          this.io.emit('question:answered', { id: row.id, answeredAt: now, answer: null })
        }
        break
      }
      default:
        break
    }
  }

  /**
   * Answer a question by id. Looks up agentSessionId + toolUseId, marks the
   * record answered, broadcasts the event, and routes the answer to the live
   * session. Returns false if the question is not found or already resolved.
   */
  /**
   * Create a question directly from a terminal agent via the bridge CLI.
   * Unlike the SDK path (which fires through `onSessionEvent`), terminal
   * agents don't have a `toolUseId` — we generate one so the schema is
   * satisfied. Returns the created question and a Promise that resolves with
   * the user's answer text when `answer()` is called.
   */
  createFromBridge(opts: {
    agentSessionId: string
    question: string
    planetId: number | null
    featureId: number | null
    workflowRunId: string | null
    nodeRunId: string | null
  }): { question: PendingQuestion; waitForAnswer: Promise<string> } {
    const toolUseId = randomUUID() // synthetic; bridges don't have MCP tool-use ids
    const q = this.createRecord({ ...opts, toolUseId })
    this.io.emit('question:created', q)
    const waitForAnswer = this.registerAnswerWaiter(q.id)
    return { question: q, waitForAnswer }
  }

  answer(questionId: string, answer: string): boolean {
    const row = this.db
      .prepare(
        `SELECT * FROM pending_questions WHERE id=? AND state='pending'`,
      )
      .get(questionId) as DbRow | undefined
    if (!row) return false

    const now = Date.now()
    this.db
      .prepare(
        `UPDATE pending_questions SET state='answered', answer=?, answered_at=?
         WHERE id=?`,
      )
      .run(answer, now, questionId)
    this.io.emit('question:answered', { id: questionId, answeredAt: now, answer })
    // Route answer to SDK session (no-op for terminal sessions).
    this.manager.get(row.agent_session_id)?.resolveClarification(row.tool_use_id, answer)
    // Notify any bridge long-poll waiting for this answer.
    this.notifyAnswerWaiter(questionId, answer)
    return true
  }

  /** Dismiss hides a question from notifications without answering. The
   *  underlying session keeps waiting; the user must answer in the terminal or
   *  restart the session. */
  dismiss(questionId: string): boolean {
    const info = this.db
      .prepare(
        `UPDATE pending_questions SET state='dismissed'
         WHERE id=? AND state='pending'`,
      )
      .run(questionId)
    if (info.changes === 0) return false
    this.io.emit('question:dismissed', { id: questionId })
    return true
  }

  /**
   * Register a one-shot waiter for a question answer. The returned Promise
   * resolves when `answer()` is called for this question, or rejects after
   * `timeoutMs` (default 30 min). Used by the bridge `/ask-user` endpoint to
   * hold the HTTP connection open until the user responds.
   */
  private registerAnswerWaiter(
    questionId: string,
    timeoutMs = 30 * 60 * 1000,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.answerWaiters.delete(questionId)
        reject(new Error('answer timeout — no response within the allowed window'))
      }, timeoutMs)
      this.answerWaiters.set(questionId, (answer) => {
        clearTimeout(timer)
        resolve(answer)
      })
    })
  }

  private notifyAnswerWaiter(questionId: string, answer: string): void {
    const waiter = this.answerWaiters.get(questionId)
    if (waiter) {
      this.answerWaiters.delete(questionId)
      waiter(answer)
    }
  }

  /** Push all currently-pending questions to a freshly-connected client. */
  catchUp(socket: TypedSocket): void {
    const rows = this.db
      .prepare(`SELECT * FROM pending_questions WHERE state='pending' ORDER BY created_at ASC`)
      .all() as DbRow[]
    socket.emit('question:list', rows.map(rowToQuestion))
  }

  private createRecord(opts: {
    agentSessionId: string
    toolUseId: string
    question: string
    planetId: number | null
    featureId: number | null
    workflowRunId: string | null
    nodeRunId: string | null
  }): PendingQuestion {
    const id = randomUUID()
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO pending_questions
           (id, agent_session_id, tool_use_id, planet_id, feature_id,
            workflow_run_id, node_run_id, question, state, created_at)
         VALUES (?,?,?,?,?,?,?,?,'pending',?)`,
      )
      .run(
        id,
        opts.agentSessionId,
        opts.toolUseId,
        opts.planetId ?? null,
        opts.featureId ?? null,
        opts.workflowRunId ?? null,
        opts.nodeRunId ?? null,
        opts.question,
        now,
      )
    return {
      id,
      agentSessionId: opts.agentSessionId,
      toolUseId: opts.toolUseId,
      planetId: opts.planetId,
      featureId: opts.featureId,
      workflowRunId: opts.workflowRunId,
      nodeRunId: opts.nodeRunId,
      question: opts.question,
      state: 'pending',
      createdAt: now,
      answeredAt: null,
      answer: null,
    }
  }

  private lookupSessionContext(agentSessionId: string): {
    planetId: number | null
    featureId: number | null
    workflowRunId: string | null
    nodeRunId: string | null
  } {
    const row = this.db
      .prepare(
        `SELECT planet_id, feature_id, run_id, node_run_id
         FROM runner_sessions WHERE id=?`,
      )
      .get(agentSessionId) as {
        planet_id: number | null
        feature_id: number | null
        run_id: string | null
        node_run_id: string | null
      } | undefined
    return {
      planetId: row?.planet_id ?? null,
      featureId: row?.feature_id ?? null,
      workflowRunId: row?.run_id ?? null,
      nodeRunId: row?.node_run_id ?? null,
    }
  }
}
