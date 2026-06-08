export const PANEL_SIZE = 150
export const PANEL_GAP = 28
export const MAX_CIRCLE = 8

export type PlanetState = 'idle' | 'running' | 'pending'

export function getCircleRadius(count: number): number {
  const circumference = count * (PANEL_SIZE + PANEL_GAP)
  return Math.max(220, circumference / (2 * Math.PI))
}

export function getPlanetState(
  planetId: number,
  features: Map<number, { status: string }[]>,
  pendingPlanetIds: Set<number>,
): PlanetState {
  if (pendingPlanetIds.has(planetId)) return 'pending'
  if (features.get(planetId)?.some((f) => f.status === 'running')) return 'running'
  return 'idle'
}
