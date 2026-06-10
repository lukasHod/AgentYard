import { describe, it, expect, beforeEach } from 'vitest'
import { useSocketStore } from './socketStore'
import type {
  FeatureSummary,
  SessionDescriptor,
  PlanetSummary,
} from '../../core/types'

const baseState = useSocketStore.getState()

const session = (id: string, state: SessionDescriptor['state'] = 'idle'): SessionDescriptor => ({
  id,
  role: 'leader',
  label: id,
  state,
})

const planet = (id: number, name: string): PlanetSummary => ({
  id,
  name,
  projectPath: `/tmp/${name}`,
  workflowId: null,
  state: 'idle',
  createdAt: 0,
  texture: 'Alpine',
  pathExists: true,
  hasClouds: false,
})

const feature = (id: number, planetId: number): FeatureSummary => ({
  id,
  planetId,
  name: `f${id}`,
  task: 'task',
  branch: null,
  worktreePath: null,
  status: 'pending',
  finalSummary: null,
  error: null,
  workflowId: 0,
  createdAt: 0,
})

beforeEach(() => {
  useSocketStore.setState({
    connected: false,
    sessionsById: new Map(),
    transcripts: new Map(),
    pendings: new Map(),
    activeRun: null,
    planets: [],
    features: new Map(),
  })
})

describe('socketStore — connection', () => {
  it('sets connected flag', () => {
    baseState.setConnected(true)
    expect(useSocketStore.getState().connected).toBe(true)
  })
})

describe('socketStore — sessions', () => {
  it('replaces all sessions on session:list', () => {
    baseState.applySessionAdded(session('s1'))
    baseState.applySessionList([session('s2'), session('s3')])
    const map = useSocketStore.getState().sessionsById
    expect(map.size).toBe(2)
    expect(map.has('s1')).toBe(false)
    expect(map.has('s2')).toBe(true)
  })

  it('adds a session immutably', () => {
    const before = useSocketStore.getState().sessionsById
    baseState.applySessionAdded(session('s1'))
    const after = useSocketStore.getState().sessionsById
    expect(after).not.toBe(before)
    expect(after.get('s1')?.id).toBe('s1')
  })

  it('removes a session', () => {
    baseState.applySessionAdded(session('s1'))
    baseState.applySessionRemoved({ id: 's1' })
    expect(useSocketStore.getState().sessionsById.has('s1')).toBe(false)
  })

  it('noops removing unknown session (preserves identity)', () => {
    const before = useSocketStore.getState().sessionsById
    baseState.applySessionRemoved({ id: 'missing' })
    expect(useSocketStore.getState().sessionsById).toBe(before)
  })

  it('updates session state on agent:state', () => {
    baseState.applySessionAdded(session('s1', 'idle'))
    baseState.applyAgentState({ agentRunId: 's1', state: 'thinking' })
    expect(useSocketStore.getState().sessionsById.get('s1')?.state).toBe('thinking')
  })

  it('noops when agent:state is same value (preserves identity)', () => {
    baseState.applySessionAdded(session('s1', 'idle'))
    const before = useSocketStore.getState().sessionsById
    baseState.applyAgentState({ agentRunId: 's1', state: 'idle' })
    expect(useSocketStore.getState().sessionsById).toBe(before)
  })
})

describe('socketStore — transcripts', () => {
  it('appends a message to the right transcript', () => {
    baseState.applyAgentMessage({
      agentRunId: 's1',
      role: 'assistant',
      content: 'hello',
      timestamp: 1,
    })
    baseState.applyAgentMessage({
      agentRunId: 's1',
      role: 'user',
      content: 'world',
      timestamp: 2,
    })
    const t = useSocketStore.getState().transcripts.get('s1')!
    expect(t).toHaveLength(2)
    expect(t[0]!.content).toBe('hello')
    expect(t[1]!.role).toBe('user')
  })

  it('does not cross transcripts between sessions', () => {
    baseState.applyAgentMessage({
      agentRunId: 's1',
      role: 'assistant',
      content: 'a',
      timestamp: 0,
    })
    baseState.applyAgentMessage({
      agentRunId: 's2',
      role: 'assistant',
      content: 'b',
      timestamp: 0,
    })
    const t = useSocketStore.getState().transcripts
    expect(t.get('s1')).toHaveLength(1)
    expect(t.get('s2')).toHaveLength(1)
  })
})

describe('socketStore — clarifications', () => {
  it('records a pending clarification', () => {
    baseState.applyClarificationRequested({
      agentRunId: 's1',
      toolUseId: 't1',
      question: 'why?',
    })
    expect(useSocketStore.getState().pendings.get('s1')).toEqual({
      toolUseId: 't1',
      question: 'why?',
    })
  })

  it('resolves only when toolUseId matches', () => {
    baseState.applyClarificationRequested({
      agentRunId: 's1',
      toolUseId: 't1',
      question: 'why?',
    })
    baseState.applyClarificationResolved({ agentRunId: 's1', toolUseId: 'mismatch' })
    expect(useSocketStore.getState().pendings.has('s1')).toBe(true)

    baseState.applyClarificationResolved({ agentRunId: 's1', toolUseId: 't1' })
    expect(useSocketStore.getState().pendings.has('s1')).toBe(false)
  })
})

describe('socketStore — runs', () => {
  it('starts a run with all nodes pending', () => {
    baseState.applyRunStarted({ runId: 'r1', task: 'do it', nodeIds: ['n1', 'n2'] })
    const run = useSocketStore.getState().activeRun!
    expect(run.runId).toBe('r1')
    expect(run.nodeStates).toEqual({ n1: 'pending', n2: 'pending' })
  })

  it('transitions node states through lifecycle', () => {
    baseState.applyRunStarted({ runId: 'r1', task: 'do it', nodeIds: ['n1'] })
    baseState.applyNodeStarted({ runId: 'r1', nodeId: 'n1', title: 'N1' })
    expect(useSocketStore.getState().activeRun?.nodeStates.n1).toBe('running')

    baseState.applyNodeComplete({ runId: 'r1', nodeId: 'n1', title: 'N1', summary: 'ok' })
    const run = useSocketStore.getState().activeRun!
    expect(run.nodeStates.n1).toBe('complete')
    expect(run.nodeSummaries.n1).toBe('ok')
  })

  it('records run failure with optional nodeId', () => {
    baseState.applyRunStarted({ runId: 'r1', task: 'do it', nodeIds: ['n1'] })
    baseState.applyRunFailed({ runId: 'r1', nodeId: 'n1', error: 'boom' })
    const run = useSocketStore.getState().activeRun!
    expect(run.error).toBe('boom')
    expect(run.nodeStates.n1).toBe('failed')
  })

  it('resetRun clears sessions/transcripts/pendings/activeRun', () => {
    baseState.applySessionAdded(session('s1'))
    baseState.applyAgentMessage({
      agentRunId: 's1',
      role: 'assistant',
      content: 'a',
      timestamp: 0,
    })
    baseState.applyClarificationRequested({
      agentRunId: 's1',
      toolUseId: 't1',
      question: '?',
    })
    baseState.applyRunStarted({ runId: 'r1', task: 't', nodeIds: ['n1'] })

    baseState.resetRun()
    const s = useSocketStore.getState()
    expect(s.sessionsById.size).toBe(0)
    expect(s.transcripts.size).toBe(0)
    expect(s.pendings.size).toBe(0)
    expect(s.activeRun).toBeNull()
  })
})

describe('socketStore — planets & features', () => {
  it('adds planet on planet:created', () => {
    baseState.applyPlanetCreated(planet(1, 'a'))
    baseState.applyPlanetCreated(planet(2, 'b'))
    const planets = useSocketStore.getState().planets
    expect(planets.map((s) => s.id)).toEqual([2, 1])
  })

  it('removes planet + its features on planet:deleted', () => {
    baseState.applyPlanetCreated(planet(1, 'a'))
    baseState.applyFeatureCreated(feature(10, 1))
    baseState.applyPlanetDeleted({ id: 1 })
    const s = useSocketStore.getState()
    expect(s.planets).toHaveLength(0)
    expect(s.features.has(1)).toBe(false)
  })

  it('noops planet:deleted for unknown planet (preserves identity)', () => {
    baseState.applyPlanetCreated(planet(1, 'a'))
    const before = useSocketStore.getState()
    baseState.applyPlanetDeleted({ id: 999 })
    const after = useSocketStore.getState()
    expect(after.planets).toBe(before.planets)
    expect(after.features).toBe(before.features)
  })

  it('adds feature to the right planet bucket', () => {
    baseState.applyFeatureCreated(feature(10, 1))
    baseState.applyFeatureCreated(feature(11, 1))
    baseState.applyFeatureCreated(feature(20, 2))
    const f = useSocketStore.getState().features
    expect(f.get(1)?.map((x) => x.id)).toEqual([11, 10])
    expect(f.get(2)?.map((x) => x.id)).toEqual([20])
  })

  it('updates a feature in place', () => {
    baseState.applyFeatureCreated(feature(10, 1))
    const updated = { ...feature(10, 1), status: 'complete' as const }
    baseState.applyFeatureUpdated(updated)
    expect(useSocketStore.getState().features.get(1)?.[0]?.status).toBe('complete')
  })
})
