import { Vector3 } from 'three'

/**
 * Live position registry. Planet and Ship components register a getter on
 * mount that reads the object's current world position (factoring in any
 * orbital rotation). The camera rig calls these getters every frame so a
 * focused planet/ship stays centred in view even as it orbits.
 *
 * The map is module-level (singleton) — there's only one solar system on
 * screen at a time, so no namespacing is needed.
 */

type Getter = () => Vector3 | null

const planetGetters = new Map<number, Getter>()
const shipGetters = new Map<string, Getter>()

const shipKey = (planetId: number, featureId: number) => `${planetId}:${featureId}`

export function registerPlanetPosition(planetId: number, getter: Getter): () => void {
  planetGetters.set(planetId, getter)
  return () => {
    if (planetGetters.get(planetId) === getter) planetGetters.delete(planetId)
  }
}

export function getPlanetPosition(planetId: number): Vector3 | null {
  return planetGetters.get(planetId)?.() ?? null
}

export function registerShipPosition(
  planetId: number,
  featureId: number,
  getter: Getter,
): () => void {
  const key = shipKey(planetId, featureId)
  shipGetters.set(key, getter)
  return () => {
    if (shipGetters.get(key) === getter) shipGetters.delete(key)
  }
}

export function getShipPosition(planetId: number, featureId: number): Vector3 | null {
  return shipGetters.get(shipKey(planetId, featureId))?.() ?? null
}
