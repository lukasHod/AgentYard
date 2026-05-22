import { useEffect } from 'react'

/**
 * Wire Escape-key dismissal for a modal/overlay.
 *
 * Pair with an `onClick={onClose}` on the backdrop element and
 * `onClick={(e) => e.stopPropagation()}` on the inner content so
 * clicks inside the card don't bubble up to the backdrop.
 *
 * Every modal in AgentYard should support all three close paths:
 * 1. Explicit close button (× / cancel)
 * 2. Escape key (this hook)
 * 3. Backdrop click (onClick on the outer div + stopPropagation inside)
 */
export function useDismissable(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])
}
