import { useEffect, useState } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { GlassButton } from '../glass/GlassButton'
import { apiPut } from '../../api'
import { pushToast } from '../../state/toastStore'
import { DEFAULT_TERMINAL_PROFILE, TERMINAL_PROFILE_OPTIONS } from '../../terminalProfiles'
import type { PlanetSummary, TerminalProfileId } from '../../../core/types'

interface Props {
  planet: PlanetSummary
  onClose: () => void
}

const SECTIONS = [{ id: 'terminals', label: 'TERMINALS' }] as const
type SectionId = (typeof SECTIONS)[number]['id']

export function PlanetSettingsOverlay({ planet, onClose }: Props) {
  const [activeSection, setActiveSection] = useState<SectionId>('terminals')

  // Esc closes — use capture phase to beat BackOutHandler's listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center backdrop-blur-sm pointer-events-auto">
      <GlassPanel className="w-[90vw] h-[90vh] flex overflow-hidden">
        <div className="w-40 border-r border-sky-400/20 p-2 space-y-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSection(s.id)}
              className={`w-full text-left px-2 py-1 rounded text-[10px] tracking-widest transition-colors ${
                activeSection === s.id
                  ? 'bg-sky-400/15 text-sky-300 border border-sky-400/40'
                  : 'text-slate-400 border border-transparent hover:text-sky-300 hover:border-sky-400/20'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-sky-400/20">
            <h2 className="text-sm tracking-widest text-sky-300">
              PLANET SETTINGS — {planet.name}
            </h2>
            <GlassButton variant="ghost" onClick={onClose}>✕ close</GlassButton>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {activeSection === 'terminals' && <TerminalsSettingsSection planet={planet} />}
          </div>
        </div>
      </GlassPanel>
    </div>
  )
}

function TerminalsSettingsSection({ planet }: { planet: PlanetSummary }) {
  const onChange = async (profile: TerminalProfileId) => {
    const res = await apiPut<PlanetSummary>(`/api/planets/${planet.id}/settings`, {
      defaultTerminalProfile: profile,
    })
    if (!res.ok) pushToast('error', `Save failed: ${res.error}`)
  }

  return (
    <div className="space-y-2 max-w-sm">
      <span className="text-[10px] tracking-widest text-slate-500">DEFAULT FEATURE TERMINAL</span>
      <p className="text-xs text-slate-400">
        Used when a feature's LEADER terminal first opens.
      </p>
      <select
        value={planet.defaultTerminalProfile ?? DEFAULT_TERMINAL_PROFILE}
        onChange={(e) => onChange(e.target.value as TerminalProfileId)}
        className="bg-black border border-sky-400/30 text-xs px-2 py-1 rounded focus:outline-none focus:border-sky-300"
      >
        {TERMINAL_PROFILE_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
