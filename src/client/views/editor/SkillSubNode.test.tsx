import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SkillSubNode } from './SkillSubNode'

vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position }: { type: string; position: string }) => (
    <div data-testid={`handle-${type}`} data-position={position} />
  ),
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}))

afterEach(() => cleanup())

describe('SkillSubNode', () => {
  it('renders skill name', () => {
    render(<SkillSubNode data={{ skillName: 'agentyard-style' }} selected={false} />)
    expect(screen.getByText('agentyard-style')).toBeInTheDocument()
  })

  it('renders "skill" type label', () => {
    render(<SkillSubNode data={{ skillName: 'my-skill' }} selected={false} />)
    expect(screen.getByText('skill')).toBeInTheDocument()
  })

  it('applies selected ring when selected=true', () => {
    const { container } = render(<SkillSubNode data={{ skillName: 'x' }} selected={true} />)
    const div = container.firstChild as HTMLElement
    expect(div.className).toContain('ring')
  })

  it('renders only a target handle (no source)', () => {
    render(<SkillSubNode data={{ skillName: 'x' }} selected={false} />)
    expect(screen.getByTestId('handle-target')).toBeInTheDocument()
    expect(screen.queryByTestId('handle-source')).not.toBeInTheDocument()
  })
})
