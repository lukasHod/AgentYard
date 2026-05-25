import type { Server as IOServer } from 'socket.io'
import type { RunEvent } from '../core/executor.js'

export type NodeRunStatus = 'pending' | 'running' | 'complete' | 'failed'

export interface ActiveRunSnapshot {
  runId: string
  task: string
  nodeIds: string[]
  nodeStates: Record<string, NodeRunStatus>
  nodeSummaries: Record<string, string>
  finalSummary?: string
  error?: string
}

/**
 * Owns the single "active run" slot: in-flight workflow snapshot + its
 * AbortController + its lifecycle Promise + the active-feature link.
 *
 * Concurrency: every method is synchronous up to the first await it makes,
 * which means callers' check-then-set sequences (e.g. "is a run in flight?
 * then claim the slot") run atomically under Node's single-threaded model.
 * Run-end cleanup hangs off the promise we capture in `begin()`.
 */
export class RunRegistry {
  private active: ActiveRunSnapshot | null = null
  private controller: AbortController | null = null
  private promise: Promise<unknown> | null = null
  private featureId: number | null = null

  constructor(private io: IOServer) {}

  /** True iff a run is in flight (started, not yet completed or failed). */
  isInFlight(): boolean {
    return this.active !== null && !this.active.finalSummary && this.active.error === undefined
  }

  /** Latest snapshot for `/run:snapshot` socket catch-up. */
  snapshot(): ActiveRunSnapshot | null {
    return this.active
  }

  activeFeatureId(): number | null {
    return this.featureId
  }

  setActiveFeatureId(id: number | null): void {
    this.featureId = id
  }

  /**
   * Claim the active slot for a new run. Caller passes a fresh AbortController
   * and a promise representing the run; on settle, controller + promise refs
   * get cleared (snapshot stays for UI catch-up).
   */
  begin(task: string, controller: AbortController, promise: Promise<unknown>): void {
    this.active = {
      runId: '(pending)',
      task,
      nodeIds: [],
      nodeStates: {},
      nodeSummaries: {},
    }
    this.controller = controller
    this.promise = promise
    promise.finally(() => {
      if (this.controller === controller) this.controller = null
      if (this.promise === promise) this.promise = null
    })
  }

  /**
   * Apply a workflow event to the in-memory snapshot AND broadcast over IO.
   * Replaces the old `emitRunEvent` closure. Returns silently when no run is
   * active (events arriving after reset, for instance).
   */
  emit(ev: RunEvent): void {
    if (!this.active) return
    this.active.runId = ev.runId
    switch (ev.type) {
      case 'run:started':
        this.active.nodeIds = ev.nodeIds
        for (const id of ev.nodeIds) this.active.nodeStates[id] = 'pending'
        break
      case 'node:started':
        this.active.nodeStates[ev.nodeId] = 'running'
        break
      case 'node:complete':
        this.active.nodeStates[ev.nodeId] = 'complete'
        this.active.nodeSummaries[ev.nodeId] = ev.summary
        break
      case 'run:complete':
        this.active.finalSummary = ev.finalSummary
        break
      case 'run:failed':
        if (ev.nodeId) this.active.nodeStates[ev.nodeId] = 'failed'
        this.active.error = ev.error
        break
    }
    this.io.emit(ev.type, ev)
  }

  /** Set the run-level error from a background catch handler. */
  setError(msg: string): void {
    if (this.active) this.active.error = msg
  }

  /** Abort + await the in-flight run (used by /api/runs/reset and shutdown). */
  async abort(): Promise<void> {
    this.controller?.abort()
    if (this.promise) {
      try {
        await this.promise
      } catch {
        // Expected on abort.
      }
    }
  }

  /**
   * Reset to empty state — aborts the in-flight run, awaits its promise so
   * background state writes can't race the clear, then drops the snapshot.
   */
  async reset(): Promise<void> {
    await this.abort()
    this.active = null
    this.controller = null
    this.promise = null
    this.featureId = null
  }
}
