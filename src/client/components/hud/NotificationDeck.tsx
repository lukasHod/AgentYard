import { useEffect, useRef } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { usePendingsMap } from '../../state/socketStore'
import { useUiStore } from '../../state/uiStore'
import { playClarificationChime, isAudioMuted } from '../../canvas/chime'
import { useNotificationRows } from './useNotificationRows'

export function NotificationDeck() {
  const pendings = usePendingsMap()
  const focusShip = useUiStore((s) => s.focusShip)
  const prevCount = useRef(0)

  // Chime when a new pending appears.
  useEffect(() => {
    if (pendings.size > prevCount.current && !isAudioMuted()) {
      playClarificationChime()
    }
    prevCount.current = pendings.size
  }, [pendings])

  const rows = useNotificationRows()

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
