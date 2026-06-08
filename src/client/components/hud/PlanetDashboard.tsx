import type { PlanetSummary } from '../../../core/types'
import { getPlanetTexturePath } from '../../scene/lib/planetTextures'
import { derivePlanetParams } from '../../scene/lib/planetParams'

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

interface PlanetPanelProps {
  planet: PlanetSummary
  state: PlanetState
  onClick: () => void
}

function PlanetPanel({ planet, state, onClick }: PlanetPanelProps) {
  const texturePath = getPlanetTexturePath(
    planet.name,
    derivePlanetParams(planet.name).surfaceType,
  )
  return (
    <button
      type="button"
      onClick={onClick}
      title={planet.name}
      style={{ width: PANEL_SIZE, height: PANEL_SIZE }}
      className={`planet-panel relative flex flex-col items-center justify-center gap-2 rounded-2xl cursor-pointer pointer-events-auto${
        state === 'pending'
          ? ' planet-panel--pending'
          : state === 'running'
            ? ' planet-panel--running'
            : ''
      }`}
    >
      {state === 'running' && <div className="planet-orb" />}
      <img
        src={texturePath}
        alt={planet.name}
        draggable={false}
        className="w-[90px] h-[90px] rounded-full object-cover"
        style={{ boxShadow: '0 0 12px rgba(0,0,0,0.6)' }}
      />
      <span
        className="text-[11px] tracking-wide truncate px-2 max-w-full text-center"
        style={{ color: '#cbd5e1' }}
      >
        {planet.name}
      </span>
    </button>
  )
}
