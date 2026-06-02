import { useEffect } from 'react'
import { useUiStore } from '../../state/uiStore'

export function BackOutHandler() {
  const back = useUiStore((s) => s.back)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back])
  return null
}
