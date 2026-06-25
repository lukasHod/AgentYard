import { reviewGateRegistry, type ReviewDecision } from '../reviewGateRegistry.js'

export function waitForReviewDecisions({
  loopRunId,
  requiredApprovers,
  timeoutMs,
  signal,
}: {
  loopRunId: string
  requiredApprovers: string[]
  timeoutMs: number
  signal?: AbortSignal
}): Promise<ReviewDecision[]> {
  if (signal?.aborted) return Promise.reject(new Error('run aborted'))

  return new Promise<ReviewDecision[]>((resolve, reject) => {
    let unregister: (() => void) | null = null

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      unregister?.()
      unregister = null
    }

    const settle = (fn: () => void) => {
      cleanup()
      fn()
    }

    const onAbort = () => {
      settle(() => reject(new Error('run aborted')))
    }

    unregister = reviewGateRegistry.register(
      loopRunId,
      requiredApprovers,
      (decisions) => settle(() => resolve(decisions)),
      (err) => settle(() => reject(err)),
      timeoutMs > 0 ? timeoutMs : undefined,
    )

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
