/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { TerminalPanel } from './TerminalPanel'
import { useSocketStore } from '../state/socketStore'

const { terminalInstances, MockTerminal } = vi.hoisted(() => {
  class MockTerminal {
    writes: string[] = []
    resets = 0
    cols = 80
    rows = 24

    loadAddon() {}
    open() {}
    write(data: string) {
      this.writes.push(data)
    }
    reset() {
      this.resets += 1
    }
    onData() {
      return { dispose() {} }
    }
    dispose() {}

    constructor() {
      terminalInstances.push(this)
    }
  }
  const terminalInstances: MockTerminal[] = []
  return { terminalInstances, MockTerminal }
})

vi.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('../state/socketClient', () => ({
  attachTerminal: vi.fn(),
  detachTerminal: vi.fn(),
  resizeTerminal: vi.fn(),
  sendTerminalInput: vi.fn(),
}))

beforeEach(() => {
  terminalInstances.length = 0
  useSocketStore.setState({
    connected: false,
    sessionsById: new Map(),
    transcripts: new Map(),
    pendings: new Map(),
    activeRun: null,
    planets: [],
    features: new Map(),
    terminalsById: new Map(),
    terminalBuffers: new Map(),
  })
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0)
    return 1
  })
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TerminalPanel', () => {
  it('appends only the new buffer suffix', () => {
    useSocketStore.getState().applyTerminalSnapshot({
      sessionId: 'term-1',
      data: 'abc',
      state: 'running',
    })

    render(<TerminalPanel sessionId="term-1" />)

    act(() => {
      useSocketStore.getState().applyTerminalData({
        sessionId: 'term-1',
        data: 'def',
        timestamp: 1,
      })
    })

    const term = terminalInstances[0]!
    expect(term.writes).toEqual(['abc', 'def'])
    expect(term.resets).toBe(0)
  })

  it('repaints when a snapshot replaces the buffer with same-length content', () => {
    useSocketStore.getState().applyTerminalSnapshot({
      sessionId: 'term-1',
      data: 'stale',
      state: 'running',
    })

    render(<TerminalPanel sessionId="term-1" />)

    act(() => {
      useSocketStore.getState().applyTerminalSnapshot({
        sessionId: 'term-1',
        data: 'fresh',
        state: 'running',
      })
    })

    const term = terminalInstances[0]!
    expect(term.writes).toEqual(['stale', 'fresh'])
    expect(term.resets).toBe(1)
  })
})
