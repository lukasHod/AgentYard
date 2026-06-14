import { create } from 'zustand'
import { useUiStore } from './uiStore'
import { useShallow } from 'zustand/react/shallow'
import type {
  AgentState,
  FeatureSummary,
  NodeRunStatus,
  RunSnapshot,
  ServerEvents,
  SessionDescriptor,
  PlanetSummary,
  TerminalSessionDescriptor,
} from '../../core/types'

export interface ChatMessage {
  id: string
  role: 'assistant' | 'user' | 'system'
  content: string
  timestamp: number
}

export interface PendingClarification {
  toolUseId: string
  question: string
}

let messageIdCounter = 0
const nextMessageId = () => `m${++messageIdCounter}`

// Stable empty references so selector hooks that fall back never return a
// fresh array/object and never trigger spurious re-renders.
const EMPTY_TRANSCRIPT: ChatMessage[] = []
const EMPTY_FEATURES: FeatureSummary[] = []

// Cap the per-terminal scrollback we hold in the browser so a runaway PTY
// doesn't grow memory without bound. The server keeps the full transcript.
const TERMINAL_BUFFER_LIMIT = 200_000

interface State {
  connected: boolean
  sessionsById: Map<string, SessionDescriptor>
  transcripts: Map<string, ChatMessage[]>
  pendings: Map<string, PendingClarification>
  activeRun: RunSnapshot | null
  planets: PlanetSummary[]
  features: Map<number, FeatureSummary[]>
  terminalsById: Map<string, TerminalSessionDescriptor>
  /** Rolling text buffer per terminal session — kept so a remount of the
   *  TerminalPanel can repaint without round-tripping `terminal:attach`. */
  terminalBuffers: Map<string, string>
}

interface Actions {
  setConnected: (b: boolean) => void
  applySessionList: (list: ServerEvents['session:list']) => void
  applySessionAdded: (s: ServerEvents['session:added']) => void
  applySessionRemoved: (ev: ServerEvents['session:removed']) => void
  applyAgentMessage: (m: ServerEvents['agent:message']) => void
  applyAgentState: (s: ServerEvents['agent:state']) => void
  applyClarificationRequested: (c: ServerEvents['clarification:requested']) => void
  applyClarificationResolved: (c: ServerEvents['clarification:resolved']) => void
  applyRunSnapshot: (snap: RunSnapshot) => void
  applyRunStarted: (ev: ServerEvents['run:started']) => void
  applyNodeStarted: (ev: ServerEvents['node:started']) => void
  applyNodeComplete: (ev: ServerEvents['node:complete']) => void
  applyRunComplete: (ev: ServerEvents['run:complete']) => void
  applyRunFailed: (ev: ServerEvents['run:failed']) => void
  applyPlanetCreated: (s: ServerEvents['planet:created']) => void
  applyPlanetDeleted: (ev: ServerEvents['planet:deleted']) => void
  applyFeatureCreated: (f: ServerEvents['feature:created']) => void
  applyFeatureUpdated: (f: ServerEvents['feature:updated']) => void
  applyFeatureDeleted: (id: number) => void
  applyTerminalList: (list: ServerEvents['terminal:list']) => void
  applyTerminalAdded: (t: ServerEvents['terminal:session:added']) => void
  applyTerminalUpdate: (t: ServerEvents['terminal:session:update']) => void
  applyTerminalRemoved: (ev: ServerEvents['terminal:session:removed']) => void
  applyTerminalData: (ev: ServerEvents['terminal:data']) => void
  applyTerminalSnapshot: (ev: ServerEvents['terminal:snapshot']) => void
  applyTerminalExit: (ev: ServerEvents['terminal:exit']) => void
  setPlanets: (planets: PlanetSummary[]) => void
  setFeatures: (features: Map<number, FeatureSummary[]>) => void
  setPlanetFeatures: (planetId: number, features: FeatureSummary[]) => void
  resetRun: () => void
}

export const useSocketStore = create<State & Actions>((set) => ({
  connected: false,
  sessionsById: new Map(),
  transcripts: new Map(),
  pendings: new Map(),
  activeRun: null,
  planets: [],
  features: new Map(),
  terminalsById: new Map(),
  terminalBuffers: new Map(),

  setConnected: (b) => set({ connected: b }),

  applySessionList: (list) => {
    set({ sessionsById: new Map(list.map((s) => [s.id, s])) })
  },

  applySessionAdded: (s) => {
    set((prev) => ({ sessionsById: new Map(prev.sessionsById).set(s.id, s) }))
  },

  applySessionRemoved: (ev) => {
    set((prev) => {
      if (!prev.sessionsById.has(ev.id)) return prev
      const next = new Map(prev.sessionsById)
      next.delete(ev.id)
      return { sessionsById: next }
    })
  },

  applyAgentMessage: (m) => {
    set((prev) => {
      const next = new Map(prev.transcripts)
      const cur = next.get(m.agentRunId) ?? []
      next.set(m.agentRunId, [
        ...cur,
        {
          id: nextMessageId(),
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        },
      ])
      return { transcripts: next }
    })
  },

  applyAgentState: (s) => {
    set((prev) => {
      const cur = prev.sessionsById.get(s.agentRunId)
      if (!cur || cur.state === s.state) return prev
      const next = new Map(prev.sessionsById)
      next.set(s.agentRunId, { ...cur, state: s.state })
      return { sessionsById: next }
    })
  },

  applyClarificationRequested: (c) => {
    set((prev) => ({
      pendings: new Map(prev.pendings).set(c.agentRunId, {
        toolUseId: c.toolUseId,
        question: c.question,
      }),
    }))
  },

  applyClarificationResolved: (c) => {
    set((prev) => {
      const cur = prev.pendings.get(c.agentRunId)
      if (!cur || cur.toolUseId !== c.toolUseId) return prev
      const next = new Map(prev.pendings)
      next.delete(c.agentRunId)
      return { pendings: next }
    })
  },

  applyRunSnapshot: (snap) => set({ activeRun: snap }),

  applyRunStarted: (ev) =>
    set({
      activeRun: {
        runId: ev.runId,
        task: ev.task,
        nodeIds: ev.nodeIds,
        nodeStates: Object.fromEntries(
          ev.nodeIds.map((id) => [id, 'pending' as NodeRunStatus]),
        ),
        nodeSummaries: {},
      },
    }),

  applyNodeStarted: (ev) =>
    set((prev) =>
      prev.activeRun
        ? {
            activeRun: {
              ...prev.activeRun,
              nodeStates: { ...prev.activeRun.nodeStates, [ev.nodeId]: 'running' },
            },
          }
        : prev,
    ),

  applyNodeComplete: (ev) =>
    set((prev) =>
      prev.activeRun
        ? {
            activeRun: {
              ...prev.activeRun,
              nodeStates: { ...prev.activeRun.nodeStates, [ev.nodeId]: 'complete' },
              nodeSummaries: { ...prev.activeRun.nodeSummaries, [ev.nodeId]: ev.summary },
            },
          }
        : prev,
    ),

  applyRunComplete: (ev) =>
    set((prev) =>
      prev.activeRun ? { activeRun: { ...prev.activeRun, finalSummary: ev.finalSummary } } : prev,
    ),

  applyRunFailed: (ev) =>
    set((prev) =>
      prev.activeRun
        ? {
            activeRun: {
              ...prev.activeRun,
              error: ev.error,
              nodeStates: ev.nodeId
                ? { ...prev.activeRun.nodeStates, [ev.nodeId]: 'failed' }
                : prev.activeRun.nodeStates,
            },
          }
        : prev,
    ),

  applyPlanetCreated: (s) => set((prev) => ({ planets: [s, ...prev.planets] })),

  applyPlanetDeleted: (ev) => {
    set((prev) => {
      const planets = prev.planets.filter((s) => s.id !== ev.id)
      if (planets.length === prev.planets.length && !prev.features.has(ev.id)) return prev
      const features = new Map(prev.features)
      features.delete(ev.id)
      return { planets, features }
    })
    const focus = useUiStore.getState().focus
    if (focus.lod !== 0 && 'planetId' in focus && focus.planetId === ev.id) {
      useUiStore.setState({ focus: { lod: 0 } })
    }
  },

  applyFeatureCreated: (f) =>
    set((prev) => {
      const features = new Map(prev.features)
      features.set(f.planetId, [f, ...(features.get(f.planetId) ?? [])])
      return { features }
    }),

  applyFeatureUpdated: (f) =>
    set((prev) => {
      const list = (prev.features.get(f.planetId) ?? []).map((x) => (x.id === f.id ? f : x))
      const features = new Map(prev.features)
      features.set(f.planetId, list)
      return { features }
    }),

  applyFeatureDeleted: (id) =>
    set((prev) => {
      const features = new Map(prev.features)
      for (const [planetId, list] of features) {
        const filtered = list.filter((f) => f.id !== id)
        if (filtered.length !== list.length) features.set(planetId, filtered)
      }
      return { features }
    }),

  applyTerminalList: (list) => {
    set({ terminalsById: new Map(list.map((t) => [t.id, t])) })
  },

  applyTerminalAdded: (t) => {
    set((prev) => ({ terminalsById: new Map(prev.terminalsById).set(t.id, t) }))
  },

  applyTerminalUpdate: (t) => {
    set((prev) => {
      const cur = prev.terminalsById.get(t.id)
      // A late update can race with a removal (the kill flow emits one update
      // after the descriptor has already been deleted on the server). Treat
      // updates as a no-op if the descriptor is gone — never resurrect it.
      if (!cur) return prev
      if (cur.state === t.state && cur.updatedAt === t.updatedAt) return prev
      return { terminalsById: new Map(prev.terminalsById).set(t.id, t) }
    })
  },

  applyTerminalRemoved: (ev) => {
    set((prev) => {
      if (!prev.terminalsById.has(ev.sessionId) && !prev.terminalBuffers.has(ev.sessionId)) {
        return prev
      }
      const terminalsById = new Map(prev.terminalsById)
      terminalsById.delete(ev.sessionId)
      const terminalBuffers = new Map(prev.terminalBuffers)
      terminalBuffers.delete(ev.sessionId)
      return { terminalsById, terminalBuffers }
    })
  },

  applyTerminalData: (ev) => {
    set((prev) => {
      const buffers = new Map(prev.terminalBuffers)
      const cur = (buffers.get(ev.sessionId) ?? '') + ev.data
      buffers.set(
        ev.sessionId,
        cur.length > TERMINAL_BUFFER_LIMIT ? cur.slice(cur.length - TERMINAL_BUFFER_LIMIT) : cur,
      )
      return { terminalBuffers: buffers }
    })
  },

  applyTerminalSnapshot: (ev) => {
    set((prev) => {
      const buffers = new Map(prev.terminalBuffers)
      buffers.set(
        ev.sessionId,
        ev.data.length > TERMINAL_BUFFER_LIMIT
          ? ev.data.slice(ev.data.length - TERMINAL_BUFFER_LIMIT)
          : ev.data,
      )
      const terminalsById = prev.terminalsById.has(ev.sessionId)
        ? new Map(prev.terminalsById).set(ev.sessionId, {
            ...prev.terminalsById.get(ev.sessionId)!,
            state: ev.state,
          })
        : prev.terminalsById
      return { terminalBuffers: buffers, terminalsById }
    })
  },

  applyTerminalExit: (ev) => {
    set((prev) => {
      const cur = prev.terminalsById.get(ev.sessionId)
      if (!cur) return prev
      // Mirror the server-side end state on the client. `terminal:session:update`
      // also fires and carries the authoritative state — this is a fast-path
      // for the common case so the UI flips immediately on exit.
      const state =
        cur.state === 'killed' || cur.state === 'failed' || cur.state === 'exited'
          ? cur.state
          : ev.code === 0
            ? 'exited'
            : ev.code === null
              ? cur.state
              : 'failed'
      const next: TerminalSessionDescriptor = {
        ...cur,
        state,
        exitCode: ev.code,
        exitSignal: ev.signal,
        pid: null,
        lastExitedAt: ev.timestamp,
      }
      return { terminalsById: new Map(prev.terminalsById).set(ev.sessionId, next) }
    })
  },

  setPlanets: (planets) => set({ planets }),
  setFeatures: (features) => set({ features }),
  setPlanetFeatures: (planetId, fs) =>
    set((prev) => {
      const next = new Map(prev.features)
      next.set(planetId, fs)
      return { features: next }
    }),

  resetRun: () =>
    set({
      sessionsById: new Map(),
      transcripts: new Map(),
      pendings: new Map(),
      activeRun: null,
    }),
}))

// ── Selector hooks ──────────────────────────────────────────────────────
//
// Each hook subscribes to the minimum slice a consumer needs. Leaf
// components that only read one transcript / one planet's features avoid
// re-rendering on unrelated socket traffic.

export const useConnected = () => useSocketStore((s) => s.connected)

/** All sessions as a list — recomputed only when the session map identity changes. */
export const useSessionList = () =>
  useSocketStore(useShallow((s) => Array.from(s.sessionsById.values())))

/** All sessions as a Map — needed by views that look up by id repeatedly. */
export const useSessionsMap = () => useSocketStore((s) => s.sessionsById)

export const useTranscriptsMap = () => useSocketStore((s) => s.transcripts)
export const usePendingsMap = () => useSocketStore((s) => s.pendings)

/** Subscribe to a single agent's transcript — only re-renders for that agent. */
export const useTranscript = (agentRunId: string): ChatMessage[] =>
  useSocketStore((s) => s.transcripts.get(agentRunId) ?? EMPTY_TRANSCRIPT)

/** Subscribe to a single agent's pending clarification. */
export const usePending = (agentRunId: string): PendingClarification | null =>
  useSocketStore((s) => s.pendings.get(agentRunId) ?? null)

export const useActiveRun = () => useSocketStore((s) => s.activeRun)

export const usePlanets = () => useSocketStore((s) => s.planets)

export const useFeaturesMap = () => useSocketStore((s) => s.features)

/** Subscribe to a single planet's features — only re-renders for that planet. */
export const useFeaturesByPlanet = (planetId: number): FeatureSummary[] =>
  useSocketStore((s) => s.features.get(planetId) ?? EMPTY_FEATURES)

const EMPTY_TERMINALS: TerminalSessionDescriptor[] = []

/** All terminal sessions as a list. */
export const useTerminalList = (): TerminalSessionDescriptor[] =>
  useSocketStore(useShallow((s) => Array.from(s.terminalsById.values())))

/** Terminal sessions scoped to a planet. */
export const useTerminalsByPlanet = (planetId: number | null): TerminalSessionDescriptor[] =>
  useSocketStore(
    useShallow((s) =>
      planetId === null
        ? EMPTY_TERMINALS
        : Array.from(s.terminalsById.values()).filter((t) => t.planetId === planetId),
    ),
  )

/** Subscribe to a single terminal's descriptor. */
export const useTerminal = (sessionId: string | null): TerminalSessionDescriptor | null =>
  useSocketStore((s) => (sessionId ? (s.terminalsById.get(sessionId) ?? null) : null))

/** Subscribe to a single terminal's rolling buffer. */
export const useTerminalBuffer = (sessionId: string | null): string =>
  useSocketStore((s) => (sessionId ? (s.terminalBuffers.get(sessionId) ?? '') : ''))
