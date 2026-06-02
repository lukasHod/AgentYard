import { useUiStore } from '../../state/uiStore'
import { FocusedPanel } from './FocusedPanel'
import { AmbientHUD } from './AmbientHUD'
import { NotificationDeck } from './NotificationDeck'
import { PanelToggleIcons } from './PanelToggleIcons'

/**
 * The HUD layer sits on top of the R3F canvas. The OUTER wrapper is
 * `pointer-events-none` so empty space passes clicks through to the 3D
 * scene (so planet/sun/ship/drone meshes stay clickable). Each child
 * component re-enables pointer events on its own absolute-positioned
 * interactive surfaces (panels, modals, etc.).
 */
export function HudLayer() {
  const focus = useUiStore((s) => s.focus)
  return (
    <div className="absolute inset-0 pointer-events-none">
      {focus.lod === 0 && <AmbientHUD />}
      {focus.lod >= 1 && <FocusedPanel />}
      {focus.lod >= 1 && <PanelToggleIcons />}
      <NotificationDeck />
    </div>
  )
}
