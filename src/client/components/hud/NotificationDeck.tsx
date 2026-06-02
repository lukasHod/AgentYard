import { useEffect, useMemo, useRef } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import {
  usePendingsMap,
  useSessionList,
  usePlanets,
  useFeaturesMap,
} from '../../state/socketStore'
import { useUiStore } from '../../state/uiStore'
import { playClarificationChime, isAudioMuted } from '../../canvas/chime'

export function NotificationDeck() {
  const pendings = usePendingsMap()
  const sessions = useSessionList()
  const planets = usePlanets()
  const features = useFeaturesMap()
  const focusShip = useUiStore((s) => s.focusShip)
  const prevCount = useRef(0)

  // Chime when a new pending appears.
  useEffect(() => {
    if (pendings.size > prevCount.current && !isAudioMuted()) {
      playClarificationChime()
    }
    prevCount.current = pendings.size
  }, [pendings])

  // Map each pending to a row, looking up which (planet, feature) the drone
  // session belongs to. Today's server invariant: only one feature runs at a
  // time per server, so any pending session is on that running feature.
  const rows = useMemo(() => {
    const out: Array<{
      droneId: string
      planetId: number
      shipFeatureId: number
      planetName: string
      featureName: string
      droneLabel: string
      question: string
    }> = []

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

  if (rows.length === 0) return null

  return (
    <div className="absolute right-4 top-20 w-80 z-30 pointer-events-auto">
      <GlassPanel className="overflow-hidden">
        <div className="px-3 py-2 border-b border-amber-300/30 text-xs tracking-widest text-amber-300">
          INBOX · {rows.length}
        </div>
        <ul>
          {rows.map((r) => (
            <li
              key={r.droneId}
              className="px-3 py-2 border-b border-amber-300/10 cursor-pointer hover:bg-amber-300/5"
              onClick={() => focusShip(r.planetId, r.shipFeatureId, r.droneId)}
            >
              <div className="text-sky-300 text-xs">
                {r.planetName} · {r.featureName} · {r.droneLabel}
              </div>
              <p className="text-slate-300 text-sm mt-0.5 line-clamp-2">{r.question}</p>
            </li>
          ))}
        </ul>
      </GlassPanel>
    </div>
  )
}
