import type { FastifyInstance, FastifyReply } from 'fastify'
import type { SessionManager } from '../runtime/SessionManager.js'
import type { TestRunRegistry } from '../runtime/testRun.js'
import type { RunRegistry } from '../runState.js'
import type { ShipChatRegistry } from '../shipChat.js'
import type { TranscriptStore } from '../transcriptStore.js'
import type { TypedIOServer } from '../socketTypes.js'

/**
 * The shared dependency bag handed to every route-registration function.
 * `apiError` is defined once in server.ts so all routes log via the same
 * Fastify logger and return identically-shaped sanitized errors.
 */
export interface AppContext {
  app: FastifyInstance
  io: TypedIOServer
  manager: SessionManager
  testRuns: TestRunRegistry
  runState: RunRegistry
  transcripts: TranscriptStore
  shipChats: ShipChatRegistry
  apiError: (
    reply: FastifyReply,
    code: number,
    publicMessage: string,
    err?: unknown,
  ) => FastifyReply
}
