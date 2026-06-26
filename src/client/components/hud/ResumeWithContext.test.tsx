import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../../api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('../../state/socketClient', () => ({
  restartTerminalWithContext: vi.fn(),
  startTerminal: vi.fn(),
  restartTerminal: vi.fn(),
  deleteTerminal: vi.fn(),
  answerQuestion: vi.fn(),
  dismissQuestion: vi.fn(),
  forceCompleteReviewLoop: vi.fn(),
  forceNextReviewIteration: vi.fn(),
}))

vi.mock('../../state/uiStore', () => ({
  useUiStore: vi.fn((sel: (s: any) => any) => {
    const s = {
      focus: { lod: 0 as const },
      selectFeatureTab: vi.fn(),
      selectedTabByFeature: {},
    }
    return sel(s)
  }),
}))

vi.mock('../../state/toastStore', () => ({
  pushToast: vi.fn(),
}))

import type { TerminalSessionDescriptor } from '../../../core/types'
import { ScopedPrimaryTerminalTestable } from './FocusedPanel'
import { apiGet } from '../../api'
import { restartTerminalWithContext } from '../../state/socketClient'

const mockApiGet = vi.mocked(apiGet)
const mockRestartWithContext = vi.mocked(restartTerminalWithContext)

const deadClaudeDescriptor: TerminalSessionDescriptor = {
  id: 'term-abc',
  profileId: 'claude-cli',
  runtimeKind: 'pty',
  featureId: 7,
  planetId: 1,
  workflowRunId: null,
  nodeRunId: null,
  agentSessionId: null,
  role: 'leader',
  cwd: '/tmp/feat',
  argv: ['claude'],
  state: 'exited',
  exitCode: 0,
  exitSignal: null,
  pid: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastStartedAt: null,
  lastExitedAt: Date.now(),
}

// At module level, make useTerminalsByPlanet dynamic:
let terminalsForTest: TerminalSessionDescriptor[] = []

vi.mock('../../state/socketStore', () => ({
  useConnected: () => true,
  useTerminalsByPlanet: () => terminalsForTest,
  useWaitingCountByAgentSession: () => 0,
  usePendingQuestions: () => [],
  useReviewLoopRunsByFeature: () => [],
  useFeaturesMap: () => new Map(),
  useSocketStore: vi.fn((sel: (s: any) => any) => sel({ setPlanetFeatures: vi.fn() })),
  useWaitingFeatureIds: () => [],
  usePlanets: () => [],
  useTerminal: () => null,
  useTerminalBuffer: () => '',
}))

vi.mock('../TerminalPanel', () => ({
  TerminalPanel: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="terminal-panel" data-session-id={sessionId} />
  ),
}))

describe('resume with context button', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    terminalsForTest = [deadClaudeDescriptor]
  })

  it('shows "↺ resume with context" on a dead claude-cli terminal with featureId', () => {
    render(<ScopedPrimaryTerminalTestable descriptor={deadClaudeDescriptor} />)
    expect(screen.getByText(/resume with context/i)).toBeInTheDocument()
  })

  it('does NOT show resume-with-context on a dead powershell terminal', () => {
    const powerShellDescriptor = { ...deadClaudeDescriptor, profileId: 'powershell' as const }
    terminalsForTest = [powerShellDescriptor]
    render(<ScopedPrimaryTerminalTestable descriptor={powerShellDescriptor} />)
    expect(screen.queryByText(/resume with context/i)).not.toBeInTheDocument()
  })

  it('fetches handoff summary and calls restartTerminalWithContext on click', async () => {
    mockApiGet.mockResolvedValueOnce({ ok: true, data: { markdown: '# Context\n...' } as any })

    render(<ScopedPrimaryTerminalTestable descriptor={deadClaudeDescriptor} />)
    fireEvent.click(screen.getByText(/resume with context/i))

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/terminals/term-abc/handoff-summary')
      expect(mockRestartWithContext).toHaveBeenCalledWith('term-abc', '# Context\n...')
    })
  })
})
