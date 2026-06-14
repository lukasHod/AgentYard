import type { NodeRunResult } from '../core/executor.js'

interface PendingGate {
  resolve: (result: NodeRunResult) => void
  reject: (err: Error) => void
}

/**
 * Singleton registry used by the AgentYard bridge to resolve workflow node
 * gates from outside the Node.js session manager (i.e. from PTY terminal
 * agents calling `agentyard mark-node-complete`).
 *
 * `runAINodeOnTerminals` registers a gate keyed by the leader terminal's
 * session id. The bridge's `/api/bridge/mark-node-complete` endpoint calls
 * `completeNode()` which resolves the gate and lets the workflow advance.
 * `runAINodeOnTerminals` also removes the gate on process-exit or timeout so
 * there are no leaks.
 */
export class BridgeRegistry {
  private gates = new Map<string, PendingGate>()

  /**
   * Register a gate for a leader terminal session. Returns an `unregister`
   * function the caller must invoke on process-exit / timeout to prevent leaks.
   */
  registerGate(
    sessionId: string,
    resolve: (result: NodeRunResult) => void,
    reject: (err: Error) => void,
  ): () => void {
    this.gates.set(sessionId, { resolve, reject })
    return () => this.gates.delete(sessionId)
  }

  /**
   * Resolve the gate for `sessionId` with a successful summary. Returns false
   * if no gate is registered (e.g. it was already resolved or never set).
   */
  completeNode(
    sessionId: string,
    summary: string,
    outputs?: Record<string, string>,
  ): boolean {
    const gate = this.gates.get(sessionId)
    if (!gate) return false
    this.gates.delete(sessionId)
    gate.resolve({ summary, outputs })
    return true
  }

  /** Fail the gate (e.g. agent reported an error via bridge). */
  failNode(sessionId: string, message: string): boolean {
    const gate = this.gates.get(sessionId)
    if (!gate) return false
    this.gates.delete(sessionId)
    gate.reject(new Error(message))
    return true
  }

  /** Number of currently registered gates — useful for health checks / tests. */
  get size(): number {
    return this.gates.size
  }
}

/** Process-global singleton — one registry per server process. */
export const bridgeRegistry = new BridgeRegistry()
