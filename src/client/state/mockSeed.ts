// Dev-only mock data seeder.
//
// Activated when the page URL has `?mock=1`. Skips the real socket + REST
// init in App.tsx and instead pushes a static scenario into the store so the
// 3D scene and HUD can be exercised without a running server:
//
//   • 2 planets (Aurora, Helios)
//   • Aurora has 1 running feature ("Add solar-wind shader")
//   • 3 agent sessions on that feature: 1 leader + 2 drones
//   • drone-test is "awaiting_clarification" (pulses pending in 3D)
//   • leader has a short seeded transcript
//   • per-planet ambient chat sessions so LOD-1 chat opens cleanly
//
// Plus a small per-session "description" registry — the FocusedPanel reads
// this to show agent info in the left panel when a drone is selected.

import type {
  FeatureSummary,
  PlanetSummary,
  SessionDescriptor,
} from '../../core/types'
import { useSocketStore } from './socketStore'

export const MOCK_ENABLED =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('mock') === '1'

const NOW = Date.now()

interface MockAgent {
  id: string
  role: SessionDescriptor['role']
  label: string
  state: SessionDescriptor['state']
  description: string
}

const MOCK_AGENTS: MockAgent[] = [
  {
    id: 'mock-leader-1',
    role: 'leader',
    label: 'arch-leader',
    state: 'thinking',
    description:
      'Architecture leader. Decomposes the feature into subtasks, allocates work to drones, and arbitrates design decisions. Has read access to the entire worktree.',
  },
  {
    id: 'mock-drone-impl-1',
    role: 'drone',
    label: 'drone-impl',
    state: 'tool_running',
    description:
      'Implementation drone. Writes and edits source code under the worktree. Holds the write lock on src/client/scene/* for the current task slice.',
  },
  {
    id: 'mock-drone-test-1',
    role: 'drone',
    label: 'drone-test',
    state: 'awaiting_clarification',
    description:
      'Verification drone. Runs the test suite and visual regressions. Currently blocked on a question for the leader about the expected sun-flare colour.',
  },
  {
    id: 'mock-chat-1',
    role: 'free',
    label: 'planet:1:chat',
    state: 'idle',
    description: 'Ambient planet chat session.',
  },
  {
    id: 'mock-chat-2',
    role: 'free',
    label: 'planet:2:chat',
    state: 'idle',
    description: 'Ambient planet chat session.',
  },
]

const DESCRIPTIONS = new Map(MOCK_AGENTS.map((a) => [a.id, a.description]))

export function getMockAgentDescription(sessionId: string): string | undefined {
  return DESCRIPTIONS.get(sessionId)
}

const MOCK_PLANETS: PlanetSummary[] = [
  {
    id: 1,
    name: 'Aurora',
    projectPath: 'C:/mock/aurora',
    workflowId: 1,
    state: 'developing',
    createdAt: NOW - 1000 * 60 * 60 * 24 * 3,
    pathExists: true,
    texture: null,
  },
  {
    id: 2,
    name: 'Helios',
    projectPath: 'C:/mock/helios',
    workflowId: 1,
    state: 'idle',
    createdAt: NOW - 1000 * 60 * 60 * 24 * 7,
    pathExists: true,
    texture: null,
  },
]

const MOCK_FEATURES: Map<number, FeatureSummary[]> = new Map([
  [
    1,
    [
      {
        id: 101,
        planetId: 1,
        name: 'solar-wind-shader',
        task:
          'Add a procedural solar-wind shader that streams particles from the sun toward each planet. The colour should track the sun palette and intensity should fall off with distance.',
        branch: 'feat/solar-wind-shader',
        worktreePath: 'C:/mock/aurora-wt/solar-wind-shader',
        status: 'running',
        finalSummary: null,
        error: null,
        workflowId: 1,
        createdAt: NOW - 1000 * 60 * 12,
      },
    ],
  ],
  [2, []],
])

const MOCK_TRANSCRIPT_LEADER = [
  {
    role: 'system' as const,
    content: 'Session started. Workflow: standard-3agent. Worktree ready.',
    timestamp: NOW - 1000 * 60 * 11,
  },
  {
    role: 'assistant' as const,
    content:
      'Decomposing "Add solar-wind shader" into:\n  1. shader source (GLSL particle field)\n  2. R3F integration in <Sun>\n  3. visual regression test\nAssigning (1+2) → drone-impl, (3) → drone-test.',
    timestamp: NOW - 1000 * 60 * 10,
  },
  {
    role: 'assistant' as const,
    content:
      'drone-test is asking what the expected hue range is for the wind streamers when the sun is in its "flare" state. Pausing for your input.',
    timestamp: NOW - 1000 * 60 * 2,
  },
]

/**
 * Seeds the socket store with the mock scenario above. Call once at app
 * startup when MOCK_ENABLED is true; safe to call multiple times (idempotent
 * via the store's setPlanets/setFeatures).
 */
export function installMockData(): void {
  const store = useSocketStore.getState()

  store.setPlanets(MOCK_PLANETS)
  store.setFeatures(MOCK_FEATURES)

  // Sessions: applySessionList replaces the whole map.
  store.applySessionList(
    MOCK_AGENTS.map(({ id, role, label, state }) => ({ id, role, label, state })),
  )

  // Seed leader transcript.
  for (const m of MOCK_TRANSCRIPT_LEADER) {
    store.applyAgentMessage({
      agentRunId: 'mock-leader-1',
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })
  }

  // drone-test has an open clarification → pending pulse in 3D.
  store.applyClarificationRequested({
    agentRunId: 'mock-drone-test-1',
    toolUseId: 'mock-tool-1',
    question:
      'What hue range should the wind streamers use when the sun is in its "flare" state? The current shader hard-codes #ffb347 but the design doc mentions a violet shift.',
  })

  // Pretend the socket connected so chat input is enabled.
  store.setConnected(true)
}
