import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type {
  AgentState,
  FeatureSummary,
  NodeRunStatus,
  RunSnapshot,
  ServerEvents,
  SessionDescriptor,
  PlanetSummary,
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

interface State {
  connected: boolean
  sessionsById: Map<string, SessionDescriptor>
  transcripts: Map<string, ChatMessage[]>
  pendings: Map<string, PendingClarification>
  activeRun: RunSnapshot | null
  planets: PlanetSummary[]
  features: Map<number, FeatureSummary[]>
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
  setPlanets: (planets: PlanetSummary[]) => void
  setFeatures: (features: Map<number, FeatureSummary[]>) => void
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

  applyPlanetDeleted: (ev) =>
    set((prev) => {
      const planets = prev.planets.filter((s) => s.id !== ev.id)
      if (planets.length === prev.planets.length && !prev.features.has(ev.id)) return prev
      const features = new Map(prev.features)
      features.delete(ev.id)
      return { planets, features }
    }),

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

  setPlanets: (planets) => set({ planets }),
  setFeatures: (features) => set({ features }),

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
