import type { NodeRunResult } from '../../core/executor.js'

export interface MarkCompleteGate {
  /**
   * Resolves when `complete()` is called by the mark_node_complete tool.
   * Rejects if the leader session closes without completing, if the optional
   * timeout fires, or if the run's AbortSignal aborts.
   */
  result: Promise<NodeRunResult>
  /** Called by the mark_node_complete tool factory. */
  complete: (r: NodeRunResult) => void
  /** Tell the gate the leader session has closed (no mark_node_complete will come). */
  notifyClosed: () => void
  /**
   * Release timers / listeners without settling. Use when the gate already
   * resolved via `complete` and you just want to make sure nothing leaks.
   */
  dispose: () => void
}

export interface CreateGateOpts {
  nodeId: string
  /** Reject if no `complete()` within this many ms. Disabled when <= 0 or undefined. */
  timeoutMs?: number
  /** Reject if this signal aborts. */
  signal?: AbortSignal
}

/**
 * Bundles the resolver/rejecter pair behind a leader-driven `mark_node_complete`
 * tool call with the closure / timeout / abort failure paths. Without this
 * gate, a leader that exits its turn without invoking the tool causes the
 * workflow executor to hang on `await runNode(...)`.
 */
export function createMarkCompleteGate(opts: CreateGateOpts): MarkCompleteGate {
  let resolveResult!: (r: NodeRunResult) => void
  let rejectResult!: (err: Error) => void
  let settled = false
  const result = new Promise<NodeRunResult>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const onAbort = () => {
    finish(() => rejectResult(new Error(`Node ${opts.nodeId}: aborted`)))
  }

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    opts.signal?.removeEventListener('abort', onAbort)
  }

  function finish(action: () => void): void {
    if (settled) return
    settled = true
    cleanup()
    action()
  }

  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timer = setTimeout(() => {
      finish(() =>
        rejectResult(
          new Error(
            `Node ${opts.nodeId}: timed out after ${opts.timeoutMs}ms without mark_node_complete`,
          ),
        ),
      )
    }, opts.timeoutMs)
  }

  if (opts.signal) {
    if (opts.signal.aborted) {
      finish(() => rejectResult(new Error(`Node ${opts.nodeId}: aborted`)))
    } else {
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }
  }

  return {
    result,
    complete: (r) => finish(() => resolveResult(r)),
    notifyClosed: () =>
      finish(() =>
        rejectResult(
          new Error(`Node ${opts.nodeId}: leader session closed before mark_node_complete`),
        ),
      ),
    dispose: () => finish(() => undefined),
  }
}
