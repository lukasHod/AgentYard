import type { Focus } from '../../state/uiStore'

export interface CameraTarget {
  position: [number, number, number]
  lookAt: [number, number, number]
}

export type PlanetPositionLookup = (planetId: number) => { x: number; y: number; z: number } | null

export type ShipPositionLookup = (
  planetId: number,
  featureId: number
) => { x: number; y: number; z: number } | null

const SYSTEM_OVERVIEW: CameraTarget = {
  position: [0, 8, 24],
  lookAt: [0, 0, 0],
}

const SUN_FOCUS: CameraTarget = {
  position: [0, 1.5, 8],
  lookAt: [0, 0, 0],
}

// Planet follow camera: position radially OUTWARD from the sun along the
// sun→planet line, slightly elevated. This keeps the camera in safe space
// (always farther from the sun than its planet, never on the sun side) so
// it can't drift through the sun or near-orbit planets as the focused
// planet sweeps around.
//
// FOLLOW_DIST controls apparent planet size on screen. Smaller = bigger
// planet. With camera fov=45° and an average planet radius ~1, a distance
// of 3 puts the planet at roughly a third of the viewport width.
const PLANET_FOLLOW_DIST = 3.0
const PLANET_FOLLOW_HEIGHT = 0.8

function planetCameraPosition(p: { x: number; y: number; z: number }): [number, number, number] {
  const sunPlane = Math.hypot(p.x, p.z) || 1
  const dirX = p.x / sunPlane
  const dirZ = p.z / sunPlane
  return [
    p.x + dirX * PLANET_FOLLOW_DIST,
    p.y + PLANET_FOLLOW_HEIGHT,
    p.z + dirZ * PLANET_FOLLOW_DIST,
  ]
}

export function cameraTargetFor(focus: Focus, lookup: PlanetPositionLookup): CameraTarget {
  if (focus.lod === 0) return SYSTEM_OVERVIEW
  if ('sun' in focus && focus.sun) return SUN_FOCUS
  if (focus.lod === 1 && 'planetId' in focus) {
    const p = lookup(focus.planetId)
    if (!p) return SYSTEM_OVERVIEW
    return { position: planetCameraPosition(p), lookAt: [p.x, p.y, p.z] }
  }
  if (focus.lod === 2) {
    const p = lookup(focus.planetId)
    if (!p) return SYSTEM_OVERVIEW
    // Fallback when no ship-position lookup is supplied: frame the planet
    // a bit closer than LOD 1 so the user sees something useful before
    // ship-aware framing kicks in (see cameraTargetForV2).
    const [cx, cy, cz] = planetCameraPosition(p)
    return {
      position: [(cx + p.x) / 2, cy, (cz + p.z) / 2],
      lookAt: [p.x, p.y, p.z],
    }
  }
  return SYSTEM_OVERVIEW
}

export function cameraTargetForV2(
  focus: Focus,
  planetLookup: PlanetPositionLookup,
  shipLookup: ShipPositionLookup,
): CameraTarget {
  if (focus.lod === 2) {
    const s = shipLookup(focus.planetId, focus.shipFeatureId)
    if (s) {
      // Frame the ship from the side + slightly above + pulled back.
      return {
        position: [s.x + 1.5, s.y + 0.8, s.z + 2.5],
        lookAt: [s.x, s.y, s.z],
      }
    }
  }
  return cameraTargetFor(focus, planetLookup)
}
