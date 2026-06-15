/**
 * Registry of pending CI/review gates.
 *
 * When `runPrGateNode` executes an `open-pr` or `pr-gate` workflow node it
 * registers a gate keyed by `featureId + kind`. The background `PrWatcher`
 * resolves the gate when the relevant condition is satisfied (CI all-green,
 * review approved). The workflow executor then advances to the next node.
 */

export type PrGateKind = 'ci' | 'review'

interface GateEntry {
  resolve: (summary: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

class PrWatcherGateRegistry {
  private gates = new Map<string, GateEntry>()

  private key(featureId: number, kind: PrGateKind): string {
    return `${featureId}:${kind}`
  }

  /** Register a gate. Returns an unregister callback (call in finally). */
  register(
    featureId: number,
    kind: PrGateKind,
    resolve: (summary: string) => void,
    reject: (err: Error) => void,
    timeoutMs?: number,
  ): () => void {
    const k = this.key(featureId, kind)
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            const g = this.gates.get(k)
            if (!g) return
            this.gates.delete(k)
            g.reject(new Error(`PR ${kind} gate timed out after ${timeoutMs}ms for feature ${featureId}`))
          }, timeoutMs)
        : null

    this.gates.set(k, { resolve, reject, timer })
    return () => {
      const g = this.gates.get(k)
      if (g?.timer) clearTimeout(g.timer)
      this.gates.delete(k)
    }
  }

  /** Called by PrWatcher when CI passes or review is approved. */
  complete(featureId: number, kind: PrGateKind, summary: string): boolean {
    const k = this.key(featureId, kind)
    const g = this.gates.get(k)
    if (!g) return false
    if (g.timer) clearTimeout(g.timer)
    this.gates.delete(k)
    g.resolve(summary)
    return true
  }

  /** Fail a gate (run aborted, merge conflict, etc.). */
  fail(featureId: number, kind: PrGateKind, err: Error): boolean {
    const k = this.key(featureId, kind)
    const g = this.gates.get(k)
    if (!g) return false
    if (g.timer) clearTimeout(g.timer)
    this.gates.delete(k)
    g.reject(err)
    return true
  }

  hasGate(featureId: number, kind: PrGateKind): boolean {
    return this.gates.has(this.key(featureId, kind))
  }
}

export const prWatcherGateRegistry = new PrWatcherGateRegistry()
