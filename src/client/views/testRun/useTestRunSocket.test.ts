import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Socket } from 'socket.io-client'
import type { SessionDescriptor } from '../../../core/types'
import type { WorkflowNode } from '../../../core/schema'
import { useTestRunSocket } from './useTestRunSocket'

/**
 * Minimal mock of the socket.io-client interface — just enough to record
 * registered listeners and let the test fire payloads back into them.
 */
class FakeSocket {
  handlers = new Map<string, Set<(...args: unknown[]) => void>>()
  on(ev: string, fn: (...args: unknown[]) => void) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set())
    this.handlers.get(ev)!.add(fn)
    return this as unknown as Socket
  }
  off(ev: string, fn: (...args: unknown[]) => void) {
    this.handlers.get(ev)?.delete(fn)
    return this as unknown as Socket
  }
  emit(ev: string, payload: unknown) {
    this.handlers.get(ev)?.forEach((h) => h(payload))
  }
  registered(ev: string) {
    return this.handlers.get(ev)?.size ?? 0
  }
}

const RUN_ID = 'run-1'
const customNodes = new Map<string, WorkflowNode>([
  ['custom-1', { id: 'custom-1', type: 'custom', title: 'Custom', scriptName: 's' } as WorkflowNode],
])

const descriptor = (id: string): SessionDescriptor => ({
  id,
  role: 'drone',
  label: id,
  state: 'idle',
})

let socket: FakeSocket
beforeEach(() => {
  socket = new FakeSocket()
})

describe('useTestRunSocket — listener lifecycle', () => {
  it('registers 13 test-run listeners when testRunId is set', () => {
    renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    const events = [
      'test-run:started',
      'test-run:complete',
      'test-run:failed',
      'test-run:node:started',
      'test-run:node:complete',
      'test-run:node:skipped',
      'test-run:session:added',
      'test-run:session:removed',
      'test-run:agent:message',
      'test-run:agent:state',
      'test-run:clarification:requested',
      'test-run:clarification:resolved',
      'test-run:teardown',
    ]
    for (const e of events) expect(socket.registered(e)).toBe(1)
  })

  it('registers nothing when testRunId is null', () => {
    renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: null, customNodes }),
    )
    expect(socket.handlers.size).toBe(0)
  })

  it('cleans up listeners on unmount', () => {
    const { unmount } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    expect(socket.registered('test-run:started')).toBe(1)
    unmount()
    expect(socket.registered('test-run:started')).toBe(0)
  })
})

describe('useTestRunSocket — testRunId filtering', () => {
  it('ignores events from other test runs', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      socket.emit('test-run:started', { testRunId: 'other', nodeIds: [], task: '', scope: 'workflow' })
    })
    expect(result.current.stage).toBe('form')
  })

  it('reacts to events from the matching test run', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      socket.emit('test-run:started', {
        testRunId: RUN_ID,
        nodeIds: ['n1'],
        task: 't',
        scope: 'workflow',
      })
    })
    expect(result.current.stage).toBe('running')
  })
})

describe('useTestRunSocket — node progress', () => {
  it('appends node started / complete entries', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      socket.emit('test-run:node:started', { testRunId: RUN_ID, nodeId: 'n1', title: 'N1' })
      socket.emit('test-run:node:complete', {
        testRunId: RUN_ID,
        nodeId: 'n1',
        title: 'N1',
        summary: 'done',
      })
    })
    expect(result.current.nodeProgress).toHaveLength(2)
    expect(result.current.nodeProgress[0]!.status).toBe('started')
    expect(result.current.nodeProgress[1]!.status).toBe('complete')
  })

  it('captures script output for custom nodes only', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      socket.emit('test-run:node:complete', {
        testRunId: RUN_ID,
        nodeId: 'custom-1',
        title: 'C',
        summary: 'script output',
      })
      socket.emit('test-run:node:complete', {
        testRunId: RUN_ID,
        nodeId: 'agent-1',
        title: 'A',
        summary: 'agent output',
      })
    })
    expect(result.current.scriptOutputs.get('custom-1')).toBe('script output')
    expect(result.current.scriptOutputs.has('agent-1')).toBe(false)
  })
})

describe('useTestRunSocket — sessions & transcripts', () => {
  it('adds a session and seeds an empty transcript', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      socket.emit('test-run:session:added', { testRunId: RUN_ID, descriptor: descriptor('s1') })
    })
    expect(result.current.sessions).toHaveLength(1)
    expect(result.current.transcripts.has('s1')).toBe(true)
    expect(result.current.transcripts.get('s1')).toEqual([])
  })

  it('appends messages to the right transcript', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      socket.emit('test-run:session:added', { testRunId: RUN_ID, descriptor: descriptor('s1') })
      socket.emit('test-run:agent:message', {
        testRunId: RUN_ID,
        agentRunId: 's1',
        role: 'assistant',
        content: 'hi',
        timestamp: 1,
      })
    })
    expect(result.current.transcripts.get('s1')).toHaveLength(1)
  })

  it('updates session state on agent:state', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      socket.emit('test-run:session:added', { testRunId: RUN_ID, descriptor: descriptor('s1') })
      socket.emit('test-run:agent:state', { testRunId: RUN_ID, agentRunId: 's1', state: 'thinking' })
    })
    expect(result.current.sessions[0]!.state).toBe('thinking')
  })

  it('marks session as done on session:removed', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      socket.emit('test-run:session:added', { testRunId: RUN_ID, descriptor: descriptor('s1') })
      socket.emit('test-run:session:removed', { testRunId: RUN_ID, id: 's1' })
    })
    expect(result.current.sessions[0]!.state).toBe('done')
  })
})

describe('useTestRunSocket — clarifications', () => {
  it('records and resolves a pending clarification', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      socket.emit('test-run:clarification:requested', {
        testRunId: RUN_ID,
        agentRunId: 's1',
        toolUseId: 't1',
        question: '?',
      })
    })
    expect(result.current.pendings.get('s1')?.toolUseId).toBe('t1')
    act(() => {
      socket.emit('test-run:clarification:resolved', {
        testRunId: RUN_ID,
        agentRunId: 's1',
        toolUseId: 't1',
      })
    })
    expect(result.current.pendings.has('s1')).toBe(false)
  })

  it('ignores resolve with mismatched toolUseId', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      socket.emit('test-run:clarification:requested', {
        testRunId: RUN_ID,
        agentRunId: 's1',
        toolUseId: 't1',
        question: '?',
      })
      socket.emit('test-run:clarification:resolved', {
        testRunId: RUN_ID,
        agentRunId: 's1',
        toolUseId: 'mismatch',
      })
    })
    expect(result.current.pendings.has('s1')).toBe(true)
  })
})

describe('useTestRunSocket — terminal states', () => {
  it('transitions to done with final summary', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      socket.emit('test-run:complete', { testRunId: RUN_ID, finalSummary: 'ok' })
    })
    expect(result.current.stage).toBe('done')
    expect(result.current.finalSummary).toBe('ok')
  })

  it('transitions to failed and records error', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      socket.emit('test-run:failed', { testRunId: RUN_ID, error: 'boom' })
    })
    expect(result.current.stage).toBe('failed')
    expect(result.current.error).toBe('boom')
  })

  it('keeps aborted stage when failed event arrives after abort', () => {
    const { result } = renderHook(() =>
      useTestRunSocket({ socket: socket as unknown as Socket, testRunId: RUN_ID, customNodes }),
    )
    act(() => {
      result.current.setStage('aborted')
    })
    act(() => {
      socket.emit('test-run:failed', { testRunId: RUN_ID, error: 'late' })
    })
    expect(result.current.stage).toBe('aborted')
    expect(result.current.error).toBe('late')
  })
})
