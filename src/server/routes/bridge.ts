import { timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { getTerminalSession, getTerminalSessionBridgeToken } from '../terminalStore.js'
import type { TerminalSessionDescriptor } from '../../core/types.js'
import { bridgeRegistry } from '../bridgeRegistry.js'
import { submitReview } from '../reviewLoopStore.js'
import { getFeature, updateFeature } from '../features.js'
import type { AppContext } from './context.js'
import { parseRequestPart } from './validation.js'
import { z } from 'zod/v4'

const SESSION_HEADER = 'x-agentyard-session-id'
const TOKEN_HEADER = 'x-agentyard-bridge-token'

/** Constant-time string compare that tolerates length mismatch without leaking it via early return. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Authenticate a bridge request: it must carry a valid session id AND the
 * matching high-entropy bridge token for that session. Returns the session on
 * success; otherwise sends the error response and returns null.
 *
 * The token — not the (short, possibly client-chosen) session id — is the
 * secret. Both are injected into the terminal's env by TerminalSessionManager.
 */
function authBridge(
  req: FastifyRequest,
  reply: FastifyReply,
  apiError: AppContext['apiError'],
): TerminalSessionDescriptor | null {
  const sessionId = req.headers[SESSION_HEADER] as string | undefined
  if (!sessionId) {
    apiError(reply, 400, 'missing X-Agentyard-Session-Id header')
    return null
  }
  const token = req.headers[TOKEN_HEADER] as string | undefined
  if (!token) {
    apiError(reply, 401, 'missing X-Agentyard-Bridge-Token header')
    return null
  }
  const session = getTerminalSession(sessionId)
  const expected = getTerminalSessionBridgeToken(sessionId)
  // Always run the compare (against a dummy when unknown) so a missing session
  // and a wrong token take the same path — no session-existence oracle.
  const ok = expected !== undefined && safeEqual(token, expected)
  if (!session || !ok) {
    apiError(reply, 401, 'invalid session id or bridge token')
    return null
  }
  return session
}
const StringRecordSchema = z.record(z.string(), z.string())
const AskUserBodySchema = z.object({ question: z.string().trim().min(1) })
const MarkNodeCompleteBodySchema = z.object({
  summary: z.string().trim().optional(),
  outputs: StringRecordSchema.optional(),
}).default({})
const AnswerBodySchema = z.object({
  questionId: z.string().min(1),
  answer: z.string(),
})
const SetPrBodySchema = z.object({
  prUrl: z.string().trim().min(1),
})
const SubmitReviewBodySchema = z.object({
  decision: z.enum(['approved', 'changes_requested']),
  findings: z.string().optional(),
})
const FailNodeBodySchema = z.object({
  error: z.string().trim().optional(),
}).default({})

/**
 * AgentYard bridge — HTTP endpoints called by `agentyard` CLI subcommands
 * running inside PTY terminal sessions.
 *
 * Authentication: every request must carry both the terminal's session id
 * (`X-Agentyard-Session-Id`) and its high-entropy bridge token
 * (`X-Agentyard-Bridge-Token`). Both are injected into the terminal's env by
 * TerminalSessionManager (AGENTYARD_SESSION_ID / AGENTYARD_BRIDGE_TOKEN) and
 * forwarded by the CLI. The token — not the short, possibly client-chosen id —
 * is the secret; see authBridge().
 *
 * All endpoints respond with `{ ok: true, ... }` on success and
 * `{ error: "..." }` (+ HTTP 4xx/5xx) on failure.
 */
export function registerBridgeRoutes(ctx: AppContext): void {
  const { app, io, pendingQuestions, apiError } = ctx

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
      const session = authBridge(req, reply, apiError)
      if (!session) return

      const body = parseRequestPart('body', req.body, AskUserBodySchema, reply)
      if (!body) return

      const { waitForAnswer } = pendingQuestions.createFromBridge({
        agentSessionId: session.id,
        question: body.question,
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
      const session = authBridge(req, reply, apiError)
      if (!session) return

      const body = parseRequestPart('body', req.body, MarkNodeCompleteBodySchema, reply)
      if (!body) return
      const summary = body.summary || 'CLI agent marked node complete'

      const resolved = bridgeRegistry.completeNode(session.id, summary, body.outputs)
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
      if (!authBridge(req, reply, apiError)) return

      const body = parseRequestPart('body', req.body, AnswerBodySchema, reply)
      if (!body) return

      const ok = pendingQuestions.answer(body.questionId, body.answer)
      if (!ok) return apiError(reply, 404, `question ${body.questionId} not found or already answered`)
      return reply.send({ ok: true })
    },
  )

  /**
   * POST /api/bridge/set-pr
   * Body: { prUrl: string }
   *
   * Called by CLI agents after successfully creating a PR (e.g. via `gh pr create`).
   * Parses the PR number and repo from the GitHub URL, persists them on the feature,
   * enables watching, and triggers an immediate poll.
   *
   * URL format: https://github.com/owner/repo/pull/123
   */
  app.post<{ Body: { prUrl?: string } }>('/api/bridge/set-pr', async (req, reply) => {
    const session = authBridge(req, reply, apiError)
    if (!session) return
    if (!session.featureId) return apiError(reply, 400, 'this terminal session has no associated feature')

    const body = parseRequestPart('body', req.body, SetPrBodySchema, reply)
    if (!body) return

    const m = body.prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
    if (!m) return apiError(reply, 400, `cannot parse GitHub PR URL: ${body.prUrl}`)

    const prRepo = m[1]!
    const prNumber = Number(m[2])

    const updated = updateFeature(session.featureId, {
      prNumber,
      prUrl: body.prUrl,
      prRepo,
      ciState: 'pending',
      reviewState: 'pending',
      watchingEnabled: true,
    })
    if (updated) io.emit('feature:updated', updated)

    // Trigger an immediate poll so the UI reflects CI state without waiting 30s.
    if (ctx.prWatcher && updated) {
      void ctx.prWatcher.pollFeature(updated)
    }

    return reply.send({ ok: true, prNumber, prRepo })
  })

  /**
   * POST /api/bridge/submit-review
   * Body: { decision: 'approved' | 'changes_requested'; findings?: string }
   *
   * Called by reviewer CLI agents when they finish evaluating the developer's
   * output. Records the decision in the review_approvals table. Once all
   * required reviewers have submitted, the review gate resolves and
   * `runReviewLoopNode` decides whether to loop back or complete the node.
   */
  app.post<{
    Body: { decision?: string; findings?: string }
  }>('/api/bridge/submit-review', async (req, reply) => {
    const session = authBridge(req, reply, apiError)
    if (!session) return

    const body = parseRequestPart('body', req.body, SubmitReviewBodySchema, reply)
    if (!body) return

    const result = submitReview(session.id, body.decision, body.findings)
    if (!result.ok) {
      return apiError(reply, 409, result.error)
    }

    io.emit('review-loop:update', result.loopRun)
    return reply.send({ ok: true, allSubmitted: result.allSubmitted })
  })

  /**
   * POST /api/bridge/fail-node
   * Body: { error: string }
   *
   * Lets a CLI agent report a fatal error, causing the node (and run) to fail.
   */
  app.post<{ Body: { error?: string } }>(
    '/api/bridge/fail-node',
    async (req, reply) => {
      const session = authBridge(req, reply, apiError)
      if (!session) return

      const body = parseRequestPart('body', req.body, FailNodeBodySchema, reply)
      if (!body) return
      const message = body.error || 'CLI agent reported failure'
      const failed = bridgeRegistry.failNode(session.id, message)
      if (!failed) {
        return apiError(reply, 409, 'no pending node gate for this session')
      }
      return reply.send({ ok: true })
    },
  )
}
