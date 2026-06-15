import { listWatchedFeatures, updateFeature, type Feature } from '../features.js'
import { prWatcherGateRegistry } from '../prWatcherGateRegistry.js'
import type { ScmAdapter } from '../scm/types.js'
import type { TypedIOServer } from '../socketTypes.js'
import type { PendingQuestionStore } from '../pendingQuestionStore.js'

/**
 * Background service that polls GitHub PR/CI state for features with
 * `watching_enabled = 1`. Converts state changes into `feature:updated`
 * socket broadcasts, HUD pending-question notifications (on failure), and
 * `prWatcherGateRegistry` resolutions (so workflow nodes can unblock).
 *
 * Uses `gh` CLI via `ScmAdapter`. If the adapter is unavailable (no `gh`
 * installed or not authenticated), the watcher just skips the poll cycle.
 */
export class PrWatcher {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly scm: ScmAdapter,
    private readonly io: TypedIOServer,
    private readonly pendingQuestions: PendingQuestionStore,
  ) {}

  start(intervalMs = 30_000): void {
    if (this.timer) return
    // Kick off an immediate first poll, then repeat.
    void this.pollAll()
    this.timer = setInterval(() => void this.pollAll(), intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Poll a single feature immediately (called on demand when watching is toggled on). */
  async pollFeature(feature: Feature): Promise<void> {
    if (!feature.prNumber || !feature.prRepo) return
    await this.poll(feature)
  }

  private async pollAll(): Promise<void> {
    const features = listWatchedFeatures()
    await Promise.allSettled(features.map((f) => this.poll(f)))
  }

  private async poll(feature: Feature): Promise<void> {
    if (!feature.prNumber || !feature.prRepo) return

    const ref: { repo: string; number: number } = {
      repo: feature.prRepo,
      number: feature.prNumber,
    }

    let prStatus
    let checksState
    try {
      ;[prStatus, checksState] = await Promise.all([
        this.scm.getPr(ref),
        this.scm.pollChecks({ repo: feature.prRepo, ref: feature.prHeadSha ?? 'HEAD' }),
      ])
    } catch {
      // `gh` unavailable or PR not found — skip this cycle silently.
      return
    }

    const now = Date.now()
    const newCiState = computeCiState(checksState.done, checksState.allGreen)
    const newReviewState = computeReviewState(prStatus.approved)
    const newMergeable = prStatus.mergeable

    const ciChanged = newCiState !== feature.ciState
    const reviewChanged = newReviewState !== feature.reviewState
    const mergeableChanged = newMergeable !== feature.prMergeable
    const headShaChanged = prStatus.headSha !== feature.prHeadSha

    // Nothing to update if all values are the same.
    if (!ciChanged && !reviewChanged && !mergeableChanged && !headShaChanged) {
      // Still update the timestamp.
      updateFeature(feature.id, { lastWatchedAt: now })
      return
    }

    const updated = updateFeature(feature.id, {
      ciState: newCiState,
      reviewState: newReviewState,
      prMergeable: newMergeable,
      prHeadSha: prStatus.headSha,
      lastWatchedAt: now,
    })
    if (updated) this.io.emit('feature:updated', updated)

    // ── React to specific transitions ──────────────────────────────────────

    // PR merged — complete the feature.
    if (prStatus.state === 'merged') {
      const done = updateFeature(feature.id, { status: 'complete', watchingEnabled: false })
      if (done) this.io.emit('feature:updated', done)
      return
    }

    // Merge conflict — block the feature and notify.
    if (mergeableChanged && newMergeable === false) {
      const blocked = updateFeature(feature.id, { status: 'blocked' })
      if (blocked) this.io.emit('feature:updated', blocked)
      this.pendingQuestions.createFromBridge({
        agentSessionId: `watcher:${feature.id}`,
        question: `Merge conflict on branch \`${feature.branch ?? 'unknown'}\` for PR #${feature.prNumber}. Resolve conflicts and push to unblock.`,
        planetId: feature.planetId,
        featureId: feature.id,
        workflowRunId: null,
        nodeRunId: null,
      })
      prWatcherGateRegistry.fail(
        feature.id,
        'ci',
        new Error(`Merge conflict on PR #${feature.prNumber}`),
      )
      prWatcherGateRegistry.fail(
        feature.id,
        'review',
        new Error(`Merge conflict on PR #${feature.prNumber}`),
      )
      return
    }

    // CI failed (newly failed, not still-failed) — notify user.
    if (ciChanged && newCiState === 'failed' && feature.ciState !== 'failed') {
      const failedRuns = checksState.runs
        .filter((r) => r.conclusion && r.conclusion !== 'success' && r.conclusion !== 'skipped' && r.conclusion !== 'neutral')
        .map((r) => r.name)
        .join(', ')
      this.pendingQuestions.createFromBridge({
        agentSessionId: `watcher:${feature.id}`,
        question: `CI failed on PR #${feature.prNumber}${failedRuns ? ` — failed: ${failedRuns}` : ''}. Push a fix or investigate.`,
        planetId: feature.planetId,
        featureId: feature.id,
        workflowRunId: null,
        nodeRunId: null,
      })
    }

    // CI success — resolve CI gate if waiting.
    if (ciChanged && newCiState === 'success') {
      prWatcherGateRegistry.complete(
        feature.id,
        'ci',
        `CI passed on PR #${feature.prNumber} (${checksState.runs.length} checks).`,
      )
    }

    // Review approved — resolve review gate if waiting.
    if (reviewChanged && newReviewState === 'approved') {
      prWatcherGateRegistry.complete(
        feature.id,
        'review',
        `PR #${feature.prNumber} approved.`,
      )
    }
  }
}

function computeCiState(done: boolean, allGreen: boolean): Feature['ciState'] {
  if (!done) return 'running'
  return allGreen ? 'success' : 'failed'
}

function computeReviewState(approved: boolean): Feature['reviewState'] {
  return approved ? 'approved' : 'pending'
}
