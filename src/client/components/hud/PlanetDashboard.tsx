import { useUiStore } from '../../state/uiStore'
import { usePlanets, useFeaturesMap } from '../../state/socketStore'
import { useNotificationRows } from './useNotificationRows'
import type { PlanetSummary } from '../../../core/types'
import { getPlanetTexturePath } from '../../scene/lib/planetTextures'
import { derivePlanetParams } from '../../scene/lib/planetParams'

export const PANEL_SIZE = 150
export const PANEL_GAP = 28
export const MAX_CIRCLE = 8

export type PlanetState = 'idle' | 'running' | 'pending'

export function getCircleRadius(count: number): number {
  const circumference = count * (PANEL_SIZE + PANEL_GAP)
  return Math.max(190, circumference / (2 * Math.PI))
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

export function PlanetDashboard() {
  const planets = usePlanets()
  const features = useFeaturesMap()
  const notifRows = useNotificationRows()
  const focusPlanet = useUiStore((s) => s.focusPlanet)

  const pendingPlanetIds = new Set(notifRows.map((r) => r.planetId))

  if (planets.length === 0) {
    return (
      <p className="text-sm text-slate-500 mt-4">
        No projects yet — create one with the + button.
      </p>
    )
  }

  // Grid layout for more than MAX_CIRCLE planets
  if (planets.length > MAX_CIRCLE) {
    return (
      <div className="flex flex-wrap gap-4 justify-center pt-4">
        {planets.map((p) => (
          <PlanetPanel
            key={p.id}
            planet={p}
            state={getPlanetState(p.id, features, pendingPlanetIds)}
            onClick={() => focusPlanet(p.id)}
          />
        ))}
      </div>
    )
  }

  // Single planet — just center it
  if (planets.length === 1) {
    return (
      <div className="flex justify-center pt-8">
        <PlanetPanel
          planet={planets[0]!}
          state={getPlanetState(planets[0]!.id, features, pendingPlanetIds)}
          onClick={() => focusPlanet(planets[0]!.id)}
        />
      </div>
    )
  }

  // Circle layout for 2–MAX_CIRCLE planets
  const r = getCircleRadius(planets.length)
  const containerSize = 2 * r + PANEL_SIZE + 32
  const center = containerSize / 2

  return (
    <div className="flex justify-center items-center w-full h-full">
      <div className="relative flex-shrink-0" style={{ width: containerSize, height: containerSize }}>
        {planets.map((p, i) => {
          const angle = (i / planets.length) * 2 * Math.PI - Math.PI / 2
          const x = center + r * Math.cos(angle) - PANEL_SIZE / 2
          const y = center + r * Math.sin(angle) - PANEL_SIZE / 2
          return (
            <div key={p.id} style={{ position: 'absolute', left: x, top: y }}>
              <PlanetPanel
                planet={p}
                state={getPlanetState(p.id, features, pendingPlanetIds)}
                onClick={() => focusPlanet(p.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
