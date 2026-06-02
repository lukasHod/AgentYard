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

// Planet follow camera: a fixed offset in WORLD coordinates applied to
// the planet's live position. As the planet orbits the sun the camera
// moves in parallel with it — so the planet stays stationary in screen
// space (off-centre, see below) while the sun drifts across the view.
//
// Tight offset for an "alongside the planet" cinematic frame.
// Distance from planet ~1.36 units (planet radius ~1) — the planet
// dominates the viewport, with only its left rim + atmosphere visible
// and the rest of the sphere extending off the right and bottom edges.
const PLANET_FOLLOW_OFFSET = { x: 0, y: 0.4, z: 1.3 }

// Shift the lookAt point along world -X so the camera looks slightly to
// the LEFT of the planet's centre. The planet then renders on the RIGHT
// side of the viewport (so its silhouette sits prominently behind the
// chat panel) while empty space + stars fill the left, mirroring a
// classic "planet shoulder" composition. Offset is in world coords, but
// because the follow camera's local +X is always aligned with world +X
// (no roll), the on-screen direction is consistent regardless of orbital
// phase.
const PLANET_LOOKAT_OFFSET = { x: -1.0, y: 0, z: 0 }

function planetCameraPosition(p: { x: number; y: number; z: number }): [number, number, number] {
  return [
    p.x + PLANET_FOLLOW_OFFSET.x,
    p.y + PLANET_FOLLOW_OFFSET.y,
    p.z + PLANET_FOLLOW_OFFSET.z,
  ]
}

function planetLookAt(p: { x: number; y: number; z: number }): [number, number, number] {
  return [
    p.x + PLANET_LOOKAT_OFFSET.x,
    p.y + PLANET_LOOKAT_OFFSET.y,
    p.z + PLANET_LOOKAT_OFFSET.z,
  ]
}

export function cameraTargetFor(focus: Focus, lookup: PlanetPositionLookup): CameraTarget {
  if (focus.lod === 0) return SYSTEM_OVERVIEW
  if ('sun' in focus && focus.sun) return SUN_FOCUS
  if (focus.lod === 1 && 'planetId' in focus) {
    const p = lookup(focus.planetId)
    if (!p) return SYSTEM_OVERVIEW
    return { position: planetCameraPosition(p), lookAt: planetLookAt(p) }
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
      lookAt: planetLookAt(p),
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
