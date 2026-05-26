import { useUiStore } from '../../state/uiStore'
import { FocusedPanel } from './FocusedPanel'
// AmbientHUD lands in Phase 7

export function HudLayer() {
  const focus = useUiStore((s) => s.focus)
  return (
    <div className="absolute inset-0 pointer-events-none">
      {focus.lod === 0 && (
        <div className="pointer-events-auto" />  /* AmbientHUD goes here in Phase 7 */
      )}
      {focus.lod >= 1 && (
        <div className="pointer-events-auto absolute inset-0">
          <FocusedPanel />
        </div>
      )}
    </div>
  )
}
