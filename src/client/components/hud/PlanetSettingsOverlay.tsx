import { useEffect, useState } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { GlassButton } from '../glass/GlassButton'
import { apiPut } from '../../api'
import { pushToast } from '../../state/toastStore'
import { DEFAULT_TERMINAL_PROFILE, TERMINAL_PROFILE_OPTIONS } from '../../terminalProfiles'
import { planetSetting } from '../../../core/types'
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

async function putPlanetSetting(planetId: number, key: string, value: string | null) {
  const res = await apiPut<PlanetSummary>(`/api/planets/${planetId}/settings`, { key, value })
  if (!res.ok) pushToast('error', `Save failed: ${res.error}`)
}

function TerminalsSettingsSection({ planet }: { planet: PlanetSummary }) {
  const onChangeProfile = (profile: TerminalProfileId) =>
    putPlanetSetting(planet.id, 'default-terminal-type', profile)

  return (
    <div className="space-y-4 max-w-sm">
      <div className="space-y-2">
        <span className="text-[10px] tracking-widest text-slate-500">DEFAULT FEATURE TERMINAL</span>
        <p className="text-xs text-slate-400">
          Used when a feature's LEADER terminal first opens.
        </p>
        <select
          value={(planetSetting(planet.settings, 'default-terminal-type') as TerminalProfileId | null) ?? DEFAULT_TERMINAL_PROFILE}
          onChange={(e) => onChangeProfile(e.target.value as TerminalProfileId)}
          className="bg-black border border-sky-400/30 text-xs px-2 py-1 rounded focus:outline-none focus:border-sky-300"
        >
          {TERMINAL_PROFILE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <span className="text-[10px] tracking-widest text-slate-500">EXTRA LAUNCH ARGS</span>
        <p className="text-xs text-slate-400">
          Extra flags appended when that CLI starts (e.g. --dangerously-skip-permissions).
        </p>
        <div className="space-y-1.5">
          {TERMINAL_PROFILE_OPTIONS.filter((opt) => opt.id === 'claude-cli' || opt.id === 'codex-cli').map((opt) => (
            <ExtraArgsField key={opt.id} planet={planet} profileId={opt.id} label={opt.label} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ExtraArgsField({
  planet,
  profileId,
  label,
}: {
  planet: PlanetSummary
  profileId: TerminalProfileId
  label: string
}) {
  const settingKey = `${profileId}-args`
  const claudeDefault = profileId === 'claude-cli' ? '--dangerously-skip-permissions' : ''
  const [value, setValue] = useState(planetSetting(planet.settings, settingKey) ?? claudeDefault)

  useEffect(() => {
    setValue(planetSetting(planet.settings, settingKey) ?? claudeDefault)
  }, [planet.settings, settingKey])

  return (
    <label className="flex items-center gap-2 text-xs text-slate-400">
      <span className="w-16 shrink-0 text-slate-500">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => putPlanetSetting(planet.id, settingKey, value.trim() || null)}
        placeholder={claudeDefault || undefined}
        className="flex-1 bg-black border border-sky-400/30 text-xs px-2 py-1 rounded focus:outline-none focus:border-sky-300"
      />
    </label>
  )
}
