import { useUiStore } from '../../state/uiStore'
import { FocusedPanel } from './FocusedPanel'
import { AmbientHUD } from './AmbientHUD'
import { NotificationDeck } from './NotificationDeck'

export function HudLayer() {
  const focus = useUiStore((s) => s.focus)
  return (
    <div className="absolute inset-0 pointer-events-none">
      {focus.lod === 0 && (
        <div className="pointer-events-auto absolute inset-0">
          <AmbientHUD />
        </div>
      )}
      {focus.lod >= 1 && (
        <div className="pointer-events-auto absolute inset-0">
          <FocusedPanel />
        </div>
      )}
      <NotificationDeck />
    </div>
  )
}
