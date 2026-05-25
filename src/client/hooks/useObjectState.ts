import { useCallback, useState } from 'react'

/**
 * Object-state hook that merges patches into the prior state. A small step
 * up from `useState({ ... })`: the setter accepts a partial, so callers
 * don't spread the prior object at every site.
 *
 * Used by the tool forms (agent / script / mcp / skill) so each form has
 * one initializer instead of N individual `useState` calls. The form's
 * submit handler reads `form.x` everywhere, and the entire state is one
 * object — easier to pass through helpers like trim() at submit time.
 */
export function useObjectState<T extends object>(
  initial: T,
): [T, (patch: Partial<T>) => void] {
  const [state, setState] = useState<T>(initial)
  const merge = useCallback(
    (patch: Partial<T>) => setState((s) => ({ ...s, ...patch })),
    [],
  )
  return [state, merge]
}
