import { GlassPanel } from '../glass/GlassPanel'
import { GlassButton } from '../glass/GlassButton'
import { GlassChip } from '../glass/GlassChip'
import { GlassSplitter } from '../glass/GlassSplitter'
import { useUiStore } from '../../state/uiStore'
import { usePlanets } from '../../state/socketStore'

export function FocusedPanel() {
  const focus = useUiStore((s) => s.focus)
  const back = useUiStore((s) => s.back)
  const splitterRatio = useUiStore((s) => s.splitterRatio)
  const setSplitterRatio = useUiStore((s) => s.setSplitterRatio)
  const planets = usePlanets()

  const planetId = focus.lod === 1 && 'planetId' in focus ? focus.planetId
                 : focus.lod === 2 ? focus.planetId
                 : null
  const planet = planetId !== null ? planets.find((p) => p.id === planetId) ?? null : null

  if (!planet) return null

  return (
    <div className="absolute inset-0 p-4">
      {/* Top bar */}
      <GlassPanel className="flex items-center justify-between px-4 py-2 mb-3">
        <div className="flex items-center gap-3">
          <GlassButton variant="ghost" onClick={() => back()}>← system</GlassButton>
          <span className="font-semibold tracking-wide">{planet.name}</span>
          <span className="font-mono text-xs text-slate-400">{planet.projectPath}</span>
        </div>
        <div className="flex items-center gap-2">
          <GlassChip>● link</GlassChip>
          <GlassButton variant="ghost">⚙ workflow editor</GlassButton>
          <GlassButton variant="danger">✕ delete</GlassButton>
        </div>
      </GlassPanel>

      {/* Body: info | splitter | chat */}
      <div className="relative" style={{ height: 'calc(100% - 80px)' }}>
        <div className="absolute inset-y-0 left-0 p-2" style={{ width: `${splitterRatio * 100}%` }}>
          <GlassPanel className="h-full p-4 overflow-y-auto">
            <div className="text-xs tracking-widest text-slate-400">INFO PANEL</div>
            <p className="text-sm text-slate-300 mt-2">Tabs land in Task 6.2.</p>
          </GlassPanel>
        </div>

        <GlassSplitter ratio={splitterRatio} onChange={setSplitterRatio} />

        <div className="absolute inset-y-0 right-0 p-2" style={{ left: `${splitterRatio * 100}%`, paddingLeft: 12 }}>
          <GlassPanel className="h-full p-4">
            <div className="text-xs tracking-widest text-slate-400">CHAT</div>
            <p className="text-sm text-slate-300 mt-2">Wired in Task 6.3.</p>
          </GlassPanel>
        </div>
      </div>
    </div>
  )
}
