import type { FastifyBaseLogger } from 'fastify'
import {
  appendEventAndUpdateSession,
  listNonTerminalRunnerSessions,
  updateRun,
} from '../runStore.js'

/**
 * On server start, every `runner_sessions` row in a non-terminal state is
 * a leftover from a prior process — the in-process Session it belonged to
 * is gone with the process. SDK sessions can't be revived (the SDK has no
 * cross-process resume), so terminate them with `runtime_lost` and surface
 * the affected runs as `stuck` so the dashboard can offer "retry / cancel".
 *
 * For PTY rows (Phase 5+) the probe-then-terminate dance lives here too —
 * see the kept TODO for the shape Phase 2 will wire.
 */
export function reconcileStaleSessions(log: FastifyBaseLogger): void {
  const stale = listNonTerminalRunnerSessions()
  if (stale.length === 0) return

  const affectedRuns = new Set<string>()
  for (const session of stale) {
    if (session.runtimeKind === 'sdk') {
      const now = Date.now()
      appendEventAndUpdateSession(
        session.id,
        { type: 'exited', code: null, reason: 'runtime_lost', ts: now },
        { state: 'terminated', reason: 'runtime_lost' },
      )
      if (session.runId) affectedRuns.add(session.runId)
      continue
    }

    // Phase 2+ wires PTY probing here: check pid + named pipe, set
    // detecting then terminated after a probe cycle.
    log.warn(
      `reconcile: PTY session ${session.id} found at boot; probe path not yet wired`,
    )
  }

  for (const runId of affectedRuns) {
    updateRun(runId, { state: 'stuck' })
  }

  log.info(
    `reconcile: terminated ${stale.length} stale runner session(s); marked ${affectedRuns.size} run(s) stuck`,
  )
}
