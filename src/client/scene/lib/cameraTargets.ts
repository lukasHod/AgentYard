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

// Planet follow camera: a fixed offset in WORLD coordinates applied to the
// planet's live position. As the planet orbits the sun, the camera moves
// in parallel with it — so the planet stays stationary in screen space
// (centre of view) but the sun is NOT stationary; it drifts across the
// view as the planet+camera pair sweep around their shared orbit. This
// gives the "co-orbiting alongside the planet" cinematic feel and avoids
// the lockstep-with-sun feel a radial-outward camera produces.
//
// Tight offset for a close cinematic frame. The z offset is intentionally
// positive so the camera sits "behind" the planet relative to the world
// +Z direction; lookAt is the planet itself.
const PLANET_FOLLOW_OFFSET = { x: 0, y: 1.5, z: 2.5 }

function planetCameraPosition(p: { x: number; y: number; z: number }): [number, number, number] {
  return [
    p.x + PLANET_FOLLOW_OFFSET.x,
    p.y + PLANET_FOLLOW_OFFSET.y,
    p.z + PLANET_FOLLOW_OFFSET.z,
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
