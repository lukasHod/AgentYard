import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { GlassSplitter } from './GlassSplitter'

describe('GlassSplitter', () => {
  it('calls onChange with clamped ratio on drag', () => {
    const onChange = vi.fn()
    const { container } = render(
      <div style={{ width: 1000, height: 500 }}>
        <GlassSplitter ratio={0.5} onChange={onChange} />
      </div>,
    )
    const handle = container.querySelector('[data-glass-splitter]')!
    // Mock the parent rect because jsdom has no layout
    handle.getBoundingClientRect = () => ({ left: 500 } as DOMRect)
    ;(handle.parentElement as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, width: 1000, right: 1000 } as DOMRect)

    fireEvent.mouseDown(handle, { clientX: 500 })
    fireEvent.mouseMove(window, { clientX: 200 })
    fireEvent.mouseUp(window)
    expect(onChange).toHaveBeenLastCalledWith(0.2)
  })
})
