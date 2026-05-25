import { useEffect, useRef } from 'react'

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
 *
 * `onClose` is read through a ref so callers can pass inline arrows
 * without re-binding the keydown listener on every render.
 */
export function useDismissable(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])
}
