import type { Focus } from '../../state/uiStore'

export interface CameraTarget {
  position: [number, number, number]
  lookAt: [number, number, number]
}

export type PlanetPositionLookup = (planetId: number) => { x: number; y: number; z: number } | null

const SYSTEM_OVERVIEW: CameraTarget = {
  position: [0, 8, 24],
  lookAt: [0, 0, 0],
}

const SUN_FOCUS: CameraTarget = {
  position: [0, 1.5, 8],
  lookAt: [0, 0, 0],
}

const PLANET_OFFSET = { x: 0, y: 1.2, z: 5 }

export function cameraTargetFor(focus: Focus, lookup: PlanetPositionLookup): CameraTarget {
  if (focus.lod === 0) return SYSTEM_OVERVIEW
  if ('sun' in focus && focus.sun) return SUN_FOCUS
  if (focus.lod === 1 && 'planetId' in focus) {
    const p = lookup(focus.planetId)
    if (!p) return SYSTEM_OVERVIEW
    return {
      position: [p.x + PLANET_OFFSET.x, p.y + PLANET_OFFSET.y, p.z + PLANET_OFFSET.z],
      lookAt: [p.x, p.y, p.z],
    }
  }
  if (focus.lod === 2) {
    const p = lookup(focus.planetId)
    if (!p) return SYSTEM_OVERVIEW
    // LOD-2 ship offset is refined in Phase 10 (needs ship orbital position).
    // For now we frame the planet's vicinity.
    return {
      position: [p.x + PLANET_OFFSET.x * 0.5, p.y + PLANET_OFFSET.y, p.z + PLANET_OFFSET.z * 0.6],
      lookAt: [p.x, p.y, p.z],
    }
  }
  return SYSTEM_OVERVIEW
}
