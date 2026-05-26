import { useState } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { GlassButton } from '../glass/GlassButton'
import { GlassChip } from '../glass/GlassChip'
import {
  useConnected,
  usePlanets,
  useFeaturesMap,
  usePendingsMap,
} from '../../state/socketStore'
import { useUiStore } from '../../state/uiStore'
import { NewPlanetModal } from './NewPlanetModal'

export function AmbientHUD() {
  const connected = useConnected()
  const planets = usePlanets()
  const features = useFeaturesMap()
  const pendings = usePendingsMap()
  const focusPlanet = useUiStore((s) => s.focusPlanet)
  const [newOpen, setNewOpen] = useState(false)
  const [muted, setMuted] = useState(false)

  const running: { planetId: number; planetName: string; featureName: string }[] = []
  for (const p of planets) {
    for (const f of features.get(p.id) ?? []) {
      if (f.status === 'running') running.push({ planetId: p.id, planetName: p.name, featureName: f.name })
    }
  }

  return (
    <>
      {/* Top bar */}
      <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-4">
        <GlassPanel className="px-4 py-2 flex items-center gap-3">
          <span className={connected ? 'text-emerald-300' : 'text-amber-300'}>●</span>
          <span className="font-semibold tracking-widest text-sm">AGENTYARD</span>
        </GlassPanel>
        <GlassPanel className="px-4 py-2 flex items-center gap-3 text-xs">
          <GlassChip>{pendings.size} pending</GlassChip>
          <button onClick={() => setMuted(!muted)} className="text-slate-300">{muted ? '🔇' : '🔊'}</button>
          <GlassButton onClick={() => setNewOpen(true)}>+ new project</GlassButton>
        </GlassPanel>
      </div>

      {/* Bottom strip */}
      {running.length > 0 && (
        <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
          {running.map((r) => (
            <GlassPanel
              key={`${r.planetId}-${r.featureName}`}
              className="px-3 py-1.5 text-xs cursor-pointer hover:scale-[1.02] transition-transform"
              onClick={() => focusPlanet(r.planetId)}
            >
              <span className="text-sky-300 animate-pulse mr-1">●</span>
              <span className="font-semibold">{r.planetName}</span>
              <span className="text-slate-400"> / {r.featureName}</span>
            </GlassPanel>
          ))}
        </div>
      )}

      {newOpen && <NewPlanetModal onClose={() => setNewOpen(false)} />}
    </>
  )
}
