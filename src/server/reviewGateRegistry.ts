/**
 * Registry of active reviewer-phase gates.
 *
 * When `runReviewLoopNode` enters the reviewer phase it registers a gate keyed
 * by `loopRunId`. The bridge `/api/bridge/submit-review` endpoint calls
 * `submitDecision()` for each reviewer. Once all required slots have submitted,
 * the gate resolves with the full set of decisions and the runner proceeds
 * to evaluate whether to loop back or complete the node.
 */

export interface ReviewDecision {
  reviewerSlot: string
  decision: 'approved' | 'changes_requested'
  findings: string | null
}

interface GateEntry {
  requiredSlots: string[]
  submitted: Map<string, ReviewDecision>
  resolve: (decisions: ReviewDecision[]) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

class ReviewGateRegistry {
  private gates = new Map<string, GateEntry>()

  /**
   * Register a gate for a review loop run.
   * Returns an unregister callback (call it in a `finally` block).
   */
  register(
    loopRunId: string,
    requiredSlots: string[],
    resolve: (decisions: ReviewDecision[]) => void,
    reject: (err: Error) => void,
    timeoutMs?: number,
  ): () => void {
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            const g = this.gates.get(loopRunId)
            if (!g) return
            this.gates.delete(loopRunId)
            g.reject(new Error(`Review phase timed out after ${timeoutMs}ms`))
          }, timeoutMs)
        : null

    this.gates.set(loopRunId, {
      requiredSlots,
      submitted: new Map(),
      resolve,
      reject,
      timer,
    })

    return () => {
      const g = this.gates.get(loopRunId)
      if (g?.timer) clearTimeout(g.timer)
      this.gates.delete(loopRunId)
    }
  }

  /**
   * Record a reviewer's decision. Returns false if no gate is registered for
   * this loop run (already completed or unknown id). When all required slots
   * have submitted, automatically resolves the gate.
   */
  submitDecision(loopRunId: string, reviewerSlot: string, decision: ReviewDecision): boolean {
    const g = this.gates.get(loopRunId)
    if (!g) return false

    g.submitted.set(reviewerSlot, decision)

    const allDone = g.requiredSlots.every((s) => g.submitted.has(s))
    if (allDone) {
      if (g.timer) clearTimeout(g.timer)
      this.gates.delete(loopRunId)
      g.resolve(Array.from(g.submitted.values()))
    }

    return true
  }

  /** Force-fail a gate (e.g. on run abort). */
  fail(loopRunId: string, err: Error): void {
    const g = this.gates.get(loopRunId)
    if (!g) return
    if (g.timer) clearTimeout(g.timer)
    this.gates.delete(loopRunId)
    g.reject(err)
  }

  activeLoopRunIds(): string[] {
    return Array.from(this.gates.keys())
  }
}

export const reviewGateRegistry = new ReviewGateRegistry()
