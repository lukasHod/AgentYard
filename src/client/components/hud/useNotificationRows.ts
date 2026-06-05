import { useMemo } from 'react'
import { usePendingsMap, useSessionList, usePlanets, useFeaturesMap } from '../../state/socketStore'

export interface NotificationRow {
  droneId: string
  planetId: number
  shipFeatureId: number
  planetName: string
  featureName: string
  droneLabel: string
  question: string
}

export function useNotificationRows(): NotificationRow[] {
  const pendings = usePendingsMap()
  const sessions = useSessionList()
  const planets = usePlanets()
  const features = useFeaturesMap()

  return useMemo(() => {
    const out: NotificationRow[] = []
    for (const [droneId, pending] of pendings) {
      const session = sessions.find((s) => s.id === droneId)
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
        droneId,
        planetId: foundPlanetId,
        shipFeatureId: foundFeatureId,
        planetName: foundPlanetName,
        featureName: foundFeatureName,
        droneLabel: session?.label ?? session?.role ?? droneId.slice(0, 6),
        question: pending.question,
      })
    }
    return out
  }, [pendings, sessions, planets, features])
}
