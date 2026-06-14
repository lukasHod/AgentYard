import type { FastifyBaseLogger } from 'fastify'
import type {
  AgentEvent,
  AgentLifecycleState,
  AgentRuntimeContext,
} from '../../core/plugins.js'
import {
  appendEventAndUpdateSession,
  getRunnerSession,
} from '../runStore.js'

/**
 * Build an AgentRuntimeContext that persists every event to runner_events
 * and updates the runner_sessions snapshot in the same transaction.
 *
 * If the session row doesn't exist (e.g. callers that bypass the registry
 * during early bring-up), the event is silently dropped — better to skip a
 * single event than crash a live chat. The caller is responsible for
 * creating the runner_sessions row before any events flow.
 */
export function createPersistingRuntimeContext(log: FastifyBaseLogger): AgentRuntimeContext {
  return {
    recordEvent(sessionId, event) {
      if (!getRunnerSession(sessionId)) {
        // Either the session was deleted (cascade) or the caller forgot to
        // register it. Don't throw — chat surfaces must not be killed by
        // bookkeeping mistakes.
        return
      }
      try {
        appendEventAndUpdateSession(sessionId, event, snapshotPatchFor(event))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn(
          `recordEvent: failed to persist event type=${event.type} session=${sessionId}: ${msg}`,
        )
      }
    },
    log: {
      info: (msg) => log.info(msg),
      warn: (msg) => log.warn(msg),
      error: (msg) => log.error(msg),
    },
  }
}

/**
 * For state-bearing events, derive a snapshot patch for runner_sessions so
 * the UI's "current state" column tracks the latest event without a full
 * replay. Everything else returns undefined and only the append happens.
 */
function snapshotPatchFor(event: AgentEvent):
  | { state?: AgentLifecycleState; reason?: NonNullable<Parameters<typeof appendEventAndUpdateSession>[2]>['reason'] }
  | undefined {
  if (event.type === 'state') return { state: event.state }
  if (event.type === 'exited') {
    return {
      state: event.code === 0 ? 'done' : 'terminated',
      reason: event.reason ?? null,
    }
  }
  return undefined
}
