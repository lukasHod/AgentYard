import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  usePendingsMap,
  usePendingQuestions,
  usePlanets,
  useFeaturesMap,
  useSocketStore,
} from '../../state/socketStore'

export interface NotificationRow {
  /** Either a durable question id or an in-memory agentRunId. */
  agentSessionId: string
  /** Durable question id when available; null for legacy in-memory entries. */
  questionId: string | null
  planetId: number
  shipFeatureId: number
  planetName: string
  featureName: string
  question: string
  /**
   * The terminal session id to select when navigating to this notification.
   * Resolved by matching pending_question.agentSessionId against
   * terminal_sessions.agentSessionId. Null when no matching terminal exists
   * yet (e.g. agent not yet backed by a terminal, or bridge not wired).
   */
  terminalSessionId: string | null
}

/**
 * Surfaces pending clarifications as inbox rows. Durable questions carry
 * exact routing context (planetId, featureId, agentSessionId) so we can
 * resolve the precise terminal tab to jump to. Legacy in-memory pendings
 * fall back to a heuristic feature search.
 */
export function useNotificationRows(): NotificationRow[] {
  const durableQuestions = usePendingQuestions()
  const pendings = usePendingsMap()
  const planets = usePlanets()
  const features = useFeaturesMap()
  // Grab the full terminals map for tab resolution — useShallow keeps this
  // stable across unrelated terminal updates.
  const terminalsById = useSocketStore(useShallow((s) => s.terminalsById))

  return useMemo(() => {
    const out: NotificationRow[] = []
    const coveredSessions = new Set<string>()

    // Durable questions — exact routing context already embedded.
    for (const q of durableQuestions) {
      if (q.planetId === null || q.featureId === null) continue
      const planet = planets.find((p) => p.id === q.planetId)
      if (!planet) continue
      const feature = (features.get(q.planetId) ?? []).find((f) => f.id === q.featureId)
      if (!feature) continue

      // Find the terminal whose agentSessionId matches this question's agent,
      // scoped to the same feature so we don't cross wires between features.
      let terminalSessionId: string | null = null
      for (const t of terminalsById.values()) {
        if (t.featureId === q.featureId && t.agentSessionId === q.agentSessionId) {
          terminalSessionId = t.id
          break
        }
      }

      coveredSessions.add(q.agentSessionId)
      out.push({
        agentSessionId: q.agentSessionId,
        questionId: q.id,
        planetId: q.planetId,
        shipFeatureId: q.featureId,
        planetName: planet.name,
        featureName: feature.chatName ?? feature.name,
        question: q.question,
        terminalSessionId,
      })
    }

    // Legacy in-memory pendings fallback — for SDK sessions whose question
    // wasn't captured by PendingQuestionStore (e.g. sandbox test runs).
    for (const [agentSessionId, pending] of pendings) {
      if (coveredSessions.has(agentSessionId)) continue
      for (const p of planets) {
        const running = (features.get(p.id) ?? []).find((f) => f.status === 'running')
        if (!running) continue
        out.push({
          agentSessionId,
          questionId: null,
          planetId: p.id,
          shipFeatureId: running.id,
          planetName: p.name,
          featureName: running.chatName ?? running.name,
          question: pending.question,
          terminalSessionId: null,
        })
        break
      }
    }

    return out
  }, [durableQuestions, pendings, planets, features, terminalsById])
}
