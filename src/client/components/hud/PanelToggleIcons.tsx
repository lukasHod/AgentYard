import { useUiStore, type InfoTab } from '../../state/uiStore'
import { useFeaturesMap } from '../../state/socketStore'
import { GlassPanel } from '../glass/GlassPanel'
import { useNotificationRows } from './useNotificationRows'

/**
 * Corner icon buttons that appear when one or both focused-panel halves are
 * hidden. They give the user a way back into a specific tab / the chat
 * without re-opening both panels.
 *
 * Layout
 *   top-left  ← info tabs (FEAT / TOOLS / PLANS / DESC [/ RUN]) — shown only
 *               when the info panel is currently CLOSED
 *   top-right ← CHAT button — shown only when the chat panel is CLOSED
 *
 * Each icon is a small glass-styled square. Clicking opens the corresponding
 * panel; the info-tab icons additionally switch the active tab.
 *
 * Only renders inside a focused LOD (1 or 2) and not on the sun panel.
 */
export function PanelToggleIcons() {
  const focus = useUiStore((s) => s.focus)
  const infoOpen = useUiStore((s) => s.infoPanelOpen)
  const chatOpen = useUiStore((s) => s.chatPanelOpen)
  const openInfoTab = useUiStore((s) => s.openInfoTab)
  const openChat = useUiStore((s) => s.openChat)
  const features = useFeaturesMap()
  const notifRows = useNotificationRows()

  if (focus.lod === 0) return null
  if (focus.lod === 1 && 'sun' in focus && focus.sun) return null

  const planetId =
    focus.lod === 1 && 'planetId' in focus
      ? focus.planetId
      : focus.lod === 2
        ? focus.planetId
        : null
  const planetFeatures = planetId !== null ? (features.get(planetId) ?? []) : []
  const hasRunning = planetFeatures.some((f) => f.status === 'running')
  // Only count notifications that belong to this planet
  const planetNotifCount = notifRows.filter((r) => r.planetId === planetId).length

  // At LOD 2 the left side shows ShipInfoPanel (no tabs) — a single INFO icon
  // is sufficient. At LOD 1 we expose all the tab choices.
  const leftItems: { tab: InfoTab; label: string; glow?: boolean }[] =
    focus.lod === 2
      ? [{ tab: 'features', label: 'INFO' }]
      : [
          { tab: 'features', label: 'FEAT' },
          { tab: 'tools', label: 'TOOLS' },
          { tab: 'plans', label: 'PLANS' },
          { tab: 'description', label: 'DESC' },
          ...(hasRunning ? [{ tab: 'run' as const, label: 'RUN' }] : []),
          {
            tab: 'notifications' as const,
            label: planetNotifCount > 0 ? `INBOX · ${planetNotifCount}` : 'INBOX',
            glow: planetNotifCount > 0,
          },
        ]

  return (
    <>
      {!infoOpen && (
        <div
          // Aligned with the side-panel top edge (matches the GlassPanel
          // top in FocusedPanel: 16 outer pad + 52 top-bar + 12 mb-3 + 8 p-2 = 88).
          className="absolute left-4 flex gap-2 pointer-events-auto"
          style={{ top: 88 }}
        >
          {leftItems.map((it) => (
            <CornerIconButton key={it.tab} onClick={() => openInfoTab(it.tab)} glow={it.glow}>
              {it.label}
            </CornerIconButton>
          ))}
        </div>
      )}
      {!chatOpen && (
        <div
          className="absolute right-4 flex gap-2 pointer-events-auto"
          style={{ top: 88 }}
        >
          <CornerIconButton onClick={openChat}>CHAT</CornerIconButton>
        </div>
      )}
    </>
  )
}

function CornerIconButton({
  onClick,
  children,
  glow,
}: {
  onClick: () => void
  children: React.ReactNode
  glow?: boolean
}) {
  return (
    <GlassPanel
      role="button"
      onClick={onClick}
      className={`px-3 py-2 text-[11px] tracking-widest cursor-pointer select-none hover:brightness-125 transition${
        glow ? ' text-amber-300 ring-1 ring-amber-400/60' : ''
      }`}
    >
      {children}
    </GlassPanel>
  )
}
