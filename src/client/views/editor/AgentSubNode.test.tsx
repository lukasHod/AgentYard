import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AgentSubNode } from './AgentSubNode'

vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position }: { type: string; position: string }) => (
    <div data-testid={`handle-${type}`} data-position={position} />
  ),
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}))

afterEach(() => cleanup())

describe('AgentSubNode', () => {
  it('renders agent name', () => {
    render(
      <AgentSubNode
        data={{ agentName: 'developer', workflowNodeId: 'n1' }}
        selected={false}
      />,
    )
    expect(screen.getByText('developer')).toBeInTheDocument()
  })

  it('renders "agent" type label', () => {
    render(
      <AgentSubNode
        data={{ agentName: 'planner', workflowNodeId: 'n1' }}
        selected={false}
      />,
    )
    expect(screen.getByText('agent')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(
      <AgentSubNode
        data={{ agentName: 'dev', description: 'Writes code', workflowNodeId: 'n1' }}
        selected={false}
      />,
    )
    expect(screen.getByText('Writes code')).toBeInTheDocument()
  })

  it('does not render description text when omitted', () => {
    render(
      <AgentSubNode
        data={{ agentName: 'dev', workflowNodeId: 'n1' }}
        selected={false}
      />,
    )
    expect(screen.queryByText(/writes|builds|creates/i)).not.toBeInTheDocument()
  })

  it('applies selected ring style when selected=true', () => {
    const { container } = render(
      <AgentSubNode
        data={{ agentName: 'dev', workflowNodeId: 'n1' }}
        selected={true}
      />,
    )
    const div = container.firstChild as HTMLElement
    expect(div.className).toContain('ring')
  })

  it('renders two target handles (top and bottom) and one source handle', () => {
    render(
      <AgentSubNode
        data={{ agentName: 'dev', workflowNodeId: 'n1' }}
        selected={false}
      />,
    )
    // conn-top and conn-bottom are both type="target"
    const targetHandles = screen.getAllByTestId('handle-target')
    expect(targetHandles).toHaveLength(2)
    // skill-out is type="source"
    expect(screen.getByTestId('handle-source')).toBeInTheDocument()
  })

  it('has cursor-pointer style', () => {
    const { container } = render(
      <AgentSubNode
        data={{ agentName: 'dev', workflowNodeId: 'n1' }}
        selected={false}
      />,
    )
    const div = container.firstChild as HTMLElement
    expect(div.className).toContain('cursor-pointer')
  })
})
