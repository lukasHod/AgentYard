import { useMemo } from 'react'
import { usePendingsMap, usePlanets, useFeaturesMap } from '../../state/socketStore'

export interface NotificationRow {
  agentSessionId: string
  planetId: number
  shipFeatureId: number
  planetName: string
  featureName: string
  question: string
}

/**
 * Surfaces pending clarifications as inbox rows. Each row points at the
 * feature that owns the asking session; clicking it sends the user to that
 * feature workspace, where they pick the right tab and answer.
 */
export function useNotificationRows(): NotificationRow[] {
  const pendings = usePendingsMap()
  const planets = usePlanets()
  const features = useFeaturesMap()

  return useMemo(() => {
    const out: NotificationRow[] = []
    for (const [agentSessionId, pending] of pendings) {
      let foundPlanetId: number | null = null
      let foundFeatureId: number | null = null
      let foundPlanetName = ''
      let foundFeatureName = ''
      for (const p of planets) {
        const running = (features.get(p.id) ?? []).find((f) => f.status === 'running')
        if (running) {
          foundPlanetId = p.id
          foundFeatureId = running.id
          foundPlanetName = p.name
          foundFeatureName = running.name
          break
        }
      }
      if (foundPlanetId === null || foundFeatureId === null) continue
      out.push({
        agentSessionId,
        planetId: foundPlanetId,
        shipFeatureId: foundFeatureId,
        planetName: foundPlanetName,
        featureName: foundFeatureName,
        question: pending.question,
      })
    }
    return out
  }, [pendings, planets, features])
}
