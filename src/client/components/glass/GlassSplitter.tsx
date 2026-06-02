import { useCallback, useEffect, useRef } from 'react'

export interface GlassSplitterProps {
  ratio: number
  onChange: (next: number) => void
  /** Min/max ratios — defaults match uiStore clamp. */
  min?: number
  max?: number
}

export function GlassSplitter({ ratio, onChange, min = 0.15, max = 0.85 }: GlassSplitterProps) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const onDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
  }, [])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || !ref.current?.parentElement) return
      const parent = ref.current.parentElement.getBoundingClientRect()
      const next = (e.clientX - parent.left) / parent.width
      onChange(Math.max(min, Math.min(max, next)))
    }
    const up = () => {
      dragging.current = false
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [onChange, min, max])

  return (
    <div
      ref={ref}
      data-glass-splitter
      onMouseDown={onDown}
      style={{
        position: 'absolute',
        left: `calc(${ratio * 100}% - 4px)`,
        top: 0,
        bottom: 0,
        width: 8,
        cursor: 'col-resize',
        background: 'rgba(125,211,252,0.10)',
        borderLeft: '1px solid rgba(125,211,252,0.25)',
        borderRight: '1px solid rgba(125,211,252,0.25)',
        zIndex: 5,
      }}
    />
  )
}
