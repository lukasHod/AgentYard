import type { RunEvent } from '../core/executor.js'
import type { TypedIOServer } from './socketTypes.js'

export type NodeRunStatus = 'pending' | 'running' | 'complete' | 'failed'

export interface ActiveRunSnapshot {
  runId: string
  task: string
  nodeIds: string[]
  nodeStates: Record<string, NodeRunStatus>
  nodeSummaries: Record<string, string>
  finalSummary?: string
  error?: string
  /** Feature this run belongs to (null for ad-hoc runs from /api/runs). */
  featureId: number | null
  /** Planet that owns the feature (null when unknown). */
  planetId: number | null
}

interface RunEntry {
  snapshot: ActiveRunSnapshot
  controller: AbortController | null
  promise: Promise<unknown> | null
}

/**
 * Tracks workflow runs. Phase 7 turned this from "the one active run slot"
 * into a registry keyed by runId, with per-planet and global concurrency
 * limits. The legacy single-slot API (isInFlight / snapshot / begin / reset
 * with no runId arg) is preserved as a compatibility shim that operates on
 * the most-recently-started run — callers that handle a single feature at
 * a time keep working without change, while new callers can register and
 * cancel multiple parallel runs via the runId-aware methods.
 *
 * Concurrency: every method is synchronous up to the first await it makes,
 * which is enough for atomic check-then-set under Node's single-threaded
 * model. Run-end cleanup hangs off the promise captured in begin().
 */
export class RunRegistry {
  private runs = new Map<string, RunEntry>()
  /** runId of the most recently started run — backs the legacy "active" API. */
  private lastBegunRunId: string | null = null
  /** Backing field for the legacy `activeFeatureId()` accessor. */
  private legacyFeatureId: number | null = null

  /** Maximum concurrent runs per planet. 0 = unlimited. */
  private readonly maxRunsPerPlanet: number
  /** Maximum concurrent runs across the whole server. 0 = unlimited. */
  private readonly maxRunsGlobal: number

  constructor(
    private io: TypedIOServer,
    opts: { maxRunsPerPlanet?: number; maxRunsGlobal?: number } = {},
  ) {
    this.maxRunsPerPlanet = opts.maxRunsPerPlanet ?? 3
    this.maxRunsGlobal = opts.maxRunsGlobal ?? 10
  }

  // ─── New runId-aware API ───────────────────────────────────────────

  /** True when there's at least one in-flight run anywhere. */
  isAnyInFlight(): boolean {
    for (const e of this.runs.values()) {
      if (this.entryInFlight(e)) return true
    }
    return false
  }

  /** True when the given feature already has a non-terminal run. */
  hasInFlightForFeature(featureId: number): boolean {
    for (const e of this.runs.values()) {
      if (e.snapshot.featureId === featureId && this.entryInFlight(e)) return true
    }
    return false
  }

  /** Latest snapshot for a specific run (or undefined). */
  snapshotById(runId: string): ActiveRunSnapshot | undefined {
    return this.runs.get(runId)?.snapshot
  }

  /** Every snapshot currently tracked — used by `/run:snapshot` catch-up
   *  to back-fill a freshly-connected dashboard tab. */
  allSnapshots(): ActiveRunSnapshot[] {
    return Array.from(this.runs.values(), (e) => e.snapshot)
  }

  /**
   * Decide whether a new run can begin right now. Returns an admit verdict
   * the caller surfaces to the user — concurrency-limit rejections are
   * NOT thrown so the API route can return a structured 409 instead of a
   * 500.
   */
  canBegin(opts: { featureId?: number | null; planetId?: number | null }):
    | { ok: true }
    | { ok: false; reason: 'feature-in-flight' | 'planet-capacity' | 'global-capacity' } {
    if (opts.featureId != null && this.hasInFlightForFeature(opts.featureId)) {
      return { ok: false, reason: 'feature-in-flight' }
    }
    if (this.maxRunsGlobal > 0) {
      const inflight = this.countInFlight()
      if (inflight >= this.maxRunsGlobal) return { ok: false, reason: 'global-capacity' }
    }
    if (this.maxRunsPerPlanet > 0 && opts.planetId != null) {
      const inflight = this.countInFlightForPlanet(opts.planetId)
      if (inflight >= this.maxRunsPerPlanet) return { ok: false, reason: 'planet-capacity' }
    }
    return { ok: true }
  }

  /**
   * Register a new run. Caller passes a stable runId (so the snapshot is
   * addressable from the first emit), a controller, and the lifecycle
   * promise; on settle, controller + promise refs get cleared (the
   * snapshot stays — UI dashboards rely on it for history).
   */
  beginRun(opts: {
    runId: string
    task: string
    featureId?: number | null
    planetId?: number | null
    controller: AbortController
    promise: Promise<unknown>
  }): void {
    const snapshot: ActiveRunSnapshot = {
      runId: opts.runId,
      task: opts.task,
      nodeIds: [],
      nodeStates: {},
      nodeSummaries: {},
      featureId: opts.featureId ?? null,
      planetId: opts.planetId ?? null,
    }
    const entry: RunEntry = {
      snapshot,
      controller: opts.controller,
      promise: opts.promise,
    }
    this.runs.set(opts.runId, entry)
    this.lastBegunRunId = opts.runId
    if (opts.featureId != null) this.legacyFeatureId = opts.featureId

    opts.promise.finally(() => {
      const e = this.runs.get(opts.runId)
      if (!e) return
      if (e.controller === opts.controller) e.controller = null
      if (e.promise === opts.promise) e.promise = null
    })
  }

  /** Abort a specific run and await its lifecycle promise. */
  async abortRun(runId: string): Promise<void> {
    const e = this.runs.get(runId)
    if (!e) return
    e.controller?.abort()
    if (e.promise) {
      try {
        await e.promise
      } catch {
        // expected on abort
      }
    }
  }

  /** Forget a run entirely — drops the snapshot too. Used by /api/runs/reset
   *  and when a feature is deleted to clean up stale snapshots. */
  async dropRun(runId: string): Promise<void> {
    await this.abortRun(runId)
    this.runs.delete(runId)
    if (this.lastBegunRunId === runId) this.lastBegunRunId = null
  }

  // ─── Legacy single-slot compatibility API ─────────────────────────
  //
  // These delegate to the runId-aware methods using the most recently
  // begun run as the implicit target. Old callers ("runs.ts", the
  // feature-chat run-tools) stay working; new callers should use the
  // runId-aware methods directly.

  /** Legacy: any run in flight (treats "in flight" as the most recent one). */
  isInFlight(): boolean {
    const e = this.lastBegunRunId ? this.runs.get(this.lastBegunRunId) : undefined
    return e ? this.entryInFlight(e) : false
  }

  /** Legacy: most-recent snapshot. */
  snapshot(): ActiveRunSnapshot | null {
    if (!this.lastBegunRunId) return null
    return this.runs.get(this.lastBegunRunId)?.snapshot ?? null
  }

  activeFeatureId(): number | null {
    return this.legacyFeatureId
  }

  setActiveFeatureId(id: number | null): void {
    this.legacyFeatureId = id
  }

  /**
   * Legacy entry-point. Mints a placeholder runId so the snapshot has a
   * stable key from the start; the executor's first `run:started` event
   * upgrades it via the emit() pipeline.
   */
  begin(task: string, controller: AbortController, promise: Promise<unknown>): void {
    const runId = `pending-${Math.random().toString(36).slice(2, 10)}`
    this.beginRun({
      runId,
      task,
      featureId: this.legacyFeatureId,
      controller,
      promise,
    })
  }

  /**
   * Apply a workflow event to the snapshot AND broadcast over IO. If the
   * event's runId doesn't match a tracked run, we look for a pending entry
   * to upgrade — the run:started event is the only one that carries the
   * real runId for the legacy begin() path.
   */
  emit(ev: RunEvent): void {
    let entry = this.runs.get(ev.runId)
    if (!entry) {
      // Try to find a pending placeholder we can upgrade. This is the
      // single transition that links the legacy begin() to the executor's
      // generated runId, which arrives in run:started.
      for (const [oldId, e] of this.runs) {
        if (oldId.startsWith('pending-') && e.snapshot.runId === oldId) {
          this.runs.delete(oldId)
          e.snapshot.runId = ev.runId
          this.runs.set(ev.runId, e)
          if (this.lastBegunRunId === oldId) this.lastBegunRunId = ev.runId
          entry = e
          break
        }
      }
      if (!entry) return
    }
    const snap = entry.snapshot
    switch (ev.type) {
      case 'run:started':
        snap.nodeIds = ev.nodeIds
        for (const id of ev.nodeIds) snap.nodeStates[id] = 'pending'
        this.io.emit('run:started', ev)
        break
      case 'node:started':
        snap.nodeStates[ev.nodeId] = 'running'
        this.io.emit('node:started', ev)
        break
      case 'node:complete':
        snap.nodeStates[ev.nodeId] = 'complete'
        snap.nodeSummaries[ev.nodeId] = ev.summary
        this.io.emit('node:complete', ev)
        break
      case 'node:skipped':
        this.io.emit('node:skipped', ev)
        break
      case 'run:complete':
        snap.finalSummary = ev.finalSummary
        this.io.emit('run:complete', ev)
        break
      case 'run:failed':
        if (ev.nodeId) snap.nodeStates[ev.nodeId] = 'failed'
        snap.error = ev.error
        this.io.emit('run:failed', ev)
        break
    }
  }

  /** Set the run-level error from a background catch handler. */
  setError(msg: string): void {
    const snap = this.snapshot()
    if (snap) snap.error = msg
  }

  /** Abort + await the most recent in-flight run. */
  async abort(): Promise<void> {
    if (!this.lastBegunRunId) return
    await this.abortRun(this.lastBegunRunId)
  }

  /** Reset to empty state — aborts every in-flight run, awaits their promises,
   *  then drops every snapshot. Used by /api/runs/reset and shutdown. */
  async reset(): Promise<void> {
    const runIds = Array.from(this.runs.keys())
    await Promise.all(runIds.map((id) => this.abortRun(id)))
    this.runs.clear()
    this.lastBegunRunId = null
    this.legacyFeatureId = null
  }

  // ─── Internals ─────────────────────────────────────────────────────

  private entryInFlight(e: RunEntry): boolean {
    return e.snapshot.finalSummary === undefined && e.snapshot.error === undefined
  }

  private countInFlight(): number {
    let n = 0
    for (const e of this.runs.values()) if (this.entryInFlight(e)) n++
    return n
  }

  private countInFlightForPlanet(planetId: number): number {
    let n = 0
    for (const e of this.runs.values()) {
      if (e.snapshot.planetId === planetId && this.entryInFlight(e)) n++
    }
    return n
  }
}
