import { getTerminalSession } from '../terminalStore.js'
import { bridgeRegistry } from '../bridgeRegistry.js'
import type { AppContext } from './context.js'

const SESSION_HEADER = 'x-agentyard-session-id'

/**
 * AgentYard bridge — HTTP endpoints called by `agentyard` CLI subcommands
 * running inside PTY terminal sessions.
 *
 * Authentication: every request must carry the terminal's session id in the
 * `X-Agentyard-Session-Id` header. The server validates it against the
 * terminal_sessions table (the id is injected by TerminalSessionManager into
 * AGENTYARD_SESSION_ID, then forwarded by the CLI as a request header).
 *
 * All endpoints respond with `{ ok: true, ... }` on success and
 * `{ error: "..." }` (+ HTTP 4xx/5xx) on failure.
 */
export function registerBridgeRoutes(ctx: AppContext): void {
  const { app, pendingQuestions, apiError } = ctx

  /**
   * POST /api/bridge/ask-user
   * Body: { question: string }
   *
   * Creates a durable pending question visible in the HUD and holds the HTTP
   * connection open until the user answers (long-poll). The CLI caller blocks
   * until this response arrives, then prints the answer to stdout so the
   * terminal agent can read it.
   */
  app.post<{ Body: { question?: string } }>(
    '/api/bridge/ask-user',
    async (req, reply) => {
      const sessionId = req.headers[SESSION_HEADER] as string | undefined
      if (!sessionId) return apiError(reply, 400, 'missing X-Agentyard-Session-Id header')

      const session = getTerminalSession(sessionId)
      if (!session) return apiError(reply, 404, `terminal session ${sessionId} not found`)

      const question = req.body?.question?.trim()
      if (!question) return apiError(reply, 400, 'question is required')

      const { waitForAnswer } = pendingQuestions.createFromBridge({
        agentSessionId: sessionId,
        question,
        planetId: session.planetId,
        featureId: session.featureId,
        workflowRunId: session.workflowRunId,
        nodeRunId: session.nodeRunId,
      })

      try {
        const answer = await waitForAnswer
        return reply.send({ ok: true, answer })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return apiError(reply, 504, `ask-user timed out or was dismissed: ${msg}`, err)
      }
    },
  )

  /**
   * POST /api/bridge/mark-node-complete
   * Body: { summary: string; outputs?: Record<string, string> }
   *
   * Resolves the node-completion gate registered by `runAINodeOnTerminals`.
   * The workflow engine advances to the next node immediately; the terminal
   * process can continue running or exit — either is fine.
   */
  app.post<{ Body: { summary?: string; outputs?: Record<string, string> } }>(
    '/api/bridge/mark-node-complete',
    async (req, reply) => {
      const sessionId = req.headers[SESSION_HEADER] as string | undefined
      if (!sessionId) return apiError(reply, 400, 'missing X-Agentyard-Session-Id header')

      if (!getTerminalSession(sessionId)) {
        return apiError(reply, 404, `terminal session ${sessionId} not found`)
      }

      const summary = (req.body?.summary ?? '').trim() || 'CLI agent marked node complete'
      const outputs = req.body?.outputs

      const resolved = bridgeRegistry.completeNode(sessionId, summary, outputs)
      if (!resolved) {
        return apiError(
          reply,
          409,
          'no pending node gate for this session — node may have already completed or timed out',
        )
      }

      return reply.send({ ok: true })
    },
  )

  /**
   * POST /api/bridge/answer
   * Body: { questionId: string; answer: string }
   *
   * Allows the terminal itself to submit an answer to a pending question
   * (e.g. after the agent auto-decides). Delegates to PendingQuestionStore.answer().
   */
  app.post<{ Body: { questionId?: string; answer?: string } }>(
    '/api/bridge/answer',
    async (req, reply) => {
      const sessionId = req.headers[SESSION_HEADER] as string | undefined
      if (!sessionId) return apiError(reply, 400, 'missing X-Agentyard-Session-Id header')

      const { questionId, answer } = req.body ?? {}
      if (!questionId) return apiError(reply, 400, 'questionId is required')
      if (typeof answer !== 'string') return apiError(reply, 400, 'answer is required')

      const ok = pendingQuestions.answer(questionId, answer)
      if (!ok) return apiError(reply, 404, `question ${questionId} not found or already answered`)
      return reply.send({ ok: true })
    },
  )

  /**
   * POST /api/bridge/fail-node
   * Body: { error: string }
   *
   * Lets a CLI agent report a fatal error, causing the node (and run) to fail.
   */
  app.post<{ Body: { error?: string } }>(
    '/api/bridge/fail-node',
    async (req, reply) => {
      const sessionId = req.headers[SESSION_HEADER] as string | undefined
      if (!sessionId) return apiError(reply, 400, 'missing X-Agentyard-Session-Id header')

      if (!getTerminalSession(sessionId)) {
        return apiError(reply, 404, `terminal session ${sessionId} not found`)
      }

      const message = (req.body?.error ?? '').trim() || 'CLI agent reported failure'
      const failed = bridgeRegistry.failNode(sessionId, message)
      if (!failed) {
        return apiError(reply, 409, 'no pending node gate for this session')
      }
      return reply.send({ ok: true })
    },
  )
}
