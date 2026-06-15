import type { FastifyInstance, FastifyReply } from 'fastify'
import type { SessionManager } from '../runtime/SessionManager.js'
import type { TestRunRegistry } from '../runtime/testRun.js'
import type { RunRegistry } from '../runState.js'
import type { PlanetChatRegistry } from '../planetChat.js'
import type { FeatureChatRegistry } from '../featureChat.js'
import type { TranscriptStore } from '../transcriptStore.js'
import type { PendingQuestionStore } from '../pendingQuestionStore.js'
import type { TypedIOServer } from '../socketTypes.js'
import type { TerminalSessionManager } from '../runtime/TerminalSessionManager.js'
import type { PrWatcher } from '../watchers/prWatcher.js'
import type { ScmAdapter } from '../scm/types.js'

/**
 * The shared dependency bag handed to every route-registration function.
 * `apiError` is defined once in server.ts so all routes log via the same
 * Fastify logger and return identically-shaped sanitized errors.
 */
export interface AppContext {
  app: FastifyInstance
  io: TypedIOServer
  manager: SessionManager
  terminals: TerminalSessionManager
  testRuns: TestRunRegistry
  runState: RunRegistry
  transcripts: TranscriptStore
  pendingQuestions: PendingQuestionStore
  planetChats: PlanetChatRegistry
  featureChats?: FeatureChatRegistry
  /** Phase 15: GitHub PR/CI watcher (optional — absent when gh is unavailable). */
  prWatcher?: PrWatcher
  /** Phase 15: SCM adapter (optional — absent when gh is unavailable). */
  scm?: ScmAdapter
  apiError: (
    reply: FastifyReply,
    code: number,
    publicMessage: string,
    err?: unknown,
  ) => FastifyReply
}
