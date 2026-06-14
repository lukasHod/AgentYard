// Dev-only mock data seeder.
//
// Activated when the page URL has `?mock=1`. Skips the real socket + REST
// init in App.tsx and instead pushes a static scenario into the store so the
// 3D scene and HUD can be exercised without a running server:
//
//   • 2 planets (Aurora, Helios)
//   • Aurora has 1 running feature ("Add solar-wind shader")
//
// The chat/terminal UIs require a live server; in mock mode they fall back
// to their "offline" empty state, which is enough for visual smoke-testing
// of the scene.

import type { FeatureSummary, PlanetSummary } from '../../core/types'
import { useSocketStore } from './socketStore'

export const MOCK_ENABLED =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('mock') === '1'

const NOW = Date.now()

const MOCK_PLANETS: PlanetSummary[] = [
  {
    id: 1,
    name: 'Aurora',
    projectPath: 'C:/mock/aurora',
    workflowId: 1,
    state: 'developing',
    createdAt: NOW - 1000 * 60 * 60 * 24 * 3,
    pathExists: true,
    texture: 'Gaseous2',
    hasClouds: true,
  },
  {
    id: 2,
    name: 'Helios',
    projectPath: 'C:/mock/helios',
    workflowId: 1,
    state: 'idle',
    createdAt: NOW - 1000 * 60 * 60 * 24 * 7,
    pathExists: true,
    texture: 'Terrestrial3',
    hasClouds: false,
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
        description: null,
        chatName: null,
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

/**
 * Seeds the socket store with the mock scenario above. Call once at app
 * startup when MOCK_ENABLED is true; safe to call multiple times (idempotent
 * via the store's setPlanets/setFeatures).
 */
export function installMockData(): void {
  const store = useSocketStore.getState()
  store.setPlanets(MOCK_PLANETS)
  store.setFeatures(MOCK_FEATURES)
  // Pretend the socket connected so terminal panels show their "spinning up"
  // state instead of "offline".
  store.setConnected(true)
}
