import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../../api', () => ({
  apiPost: vi.fn(),
}))

vi.mock('../../state/uiStore', () => ({
  useUiStore: vi.fn((sel: (s: any) => any) => {
    const focusShip = vi.fn()
    const s = { focus: { lod: 0 as const }, focusShip }
    return sel(s)
  }),
}))

vi.mock('../../state/socketStore', () => ({
  useWaitingFeatureIds: () => new Set<number>(),
}))

vi.mock('../../state/toastStore', () => ({
  pushToast: vi.fn(),
}))

vi.mock('../HandoffDialog', () => ({
  HandoffDialog: () => null,
}))

import { FeaturesTab } from './FocusedPanelTabs'
import { apiPost } from '../../api'

const mockApiPost = vi.mocked(apiPost)

describe('FeaturesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows form fields when + New Feature is clicked', async () => {
    render(<FeaturesTab features={[]} planetId={1} />)
    fireEvent.click(screen.getByText('+ New Feature'))
    expect(screen.getByPlaceholderText('feature-name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Describe what to build…')).toBeInTheDocument()
  })

  it('submits name and task to the API and hides form on success', async () => {
    mockApiPost.mockResolvedValueOnce({ ok: true, data: { id: 42, name: 'alpha', task: 'do thing' } as any })

    render(<FeaturesTab features={[]} planetId={1} />)
    fireEvent.click(screen.getByText('+ New Feature'))

    fireEvent.change(screen.getByPlaceholderText('feature-name'), { target: { value: 'alpha' } })
    fireEvent.change(screen.getByPlaceholderText('Describe what to build…'), { target: { value: 'do thing' } })
    fireEvent.click(screen.getByText('Start'))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/api/planets/1/features',
        { name: 'alpha', task: 'do thing' },
      )
    })
    // Form should be hidden after success
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('feature-name')).not.toBeInTheDocument()
    })
  })

  it('Cancel button hides the form', () => {
    render(<FeaturesTab features={[]} planetId={1} />)
    fireEvent.click(screen.getByText('+ New Feature'))
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByPlaceholderText('feature-name')).not.toBeInTheDocument()
  })
})
