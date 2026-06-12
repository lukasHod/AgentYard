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

/**
 * Spherical overview position around `target`. Yaw rotates around world Y,
 * pitch tilts up/down. With target=(0,0,0), radius=hypot(8,24), yaw=0,
 * pitch=atan2(8,24) this reproduces SYSTEM_OVERVIEW.
 */
export function systemOverviewTarget(
  yaw: number,
  pitch: number,
  radius: number,
  target: { x: number; y: number; z: number },
): CameraTarget {
  const cp = Math.cos(pitch)
  return {
    position: [
      target.x + radius * cp * Math.sin(yaw),
      target.y + radius * Math.sin(pitch),
      target.z + radius * cp * Math.cos(yaw),
    ],
    lookAt: [target.x, target.y, target.z],
  }
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
// Offset for the planetary close-up frame.
// z=1.6 puts the camera at ~1.65 units from the planet centre, which is
// safely outside the atmosphere shell for every planet size (max shell
// radius = 1.2 × 1.25 = 1.5).  Keeping z < 1.3 would place the camera
// *inside* the shell for large planets, making the FrontSide material
// invisible due to backface culling.
// NOTE: at this distance the ship orbit ring (radius ≈ planet_radius × 1.8)
// extends behind the camera, so ships are NOT visible at LOD 1.  They are
// visible at LOD 2 (click the planet chip or the ship itself).
const PLANET_FOLLOW_OFFSET = { x: 0, y: 0.4, z: 1.6 }

// Shift lookAt left so the planet sits right-of-centre, leaving room for
// the info panel on the left.
const PLANET_LOOKAT_OFFSET = { x: -2.4, y: 0, z: 0 }

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
    // Rotate camera around planet's Y-axis so the planet slides off to the
    // right of frame when a feature opens.  Looking in the orbit-tangent
    // direction puts the planet ~90° to camera-right (outside any normal
    // FOV) and the existing 0.8 s lerp slides the planet from its LOD-1
    // position to the right edge and off-screen naturally.
    const SLIP = Math.PI * (70 / 180) // 70 degrees CCW around planet Y
    const cosA = Math.cos(SLIP)
    const sinA = Math.sin(SLIP)
    // Rotate PLANET_FOLLOW_OFFSET (0, 0.4, 1.6) around Y by SLIP
    const rx = -PLANET_FOLLOW_OFFSET.z * sinA // 0*cos - 1.6*sin
    const rz =  PLANET_FOLLOW_OFFSET.z * cosA // 0*sin + 1.6*cos
    const AHEAD = 6 // units to look ahead along tangent
    return {
      position: [p.x + rx, p.y + PLANET_FOLLOW_OFFSET.y, p.z + rz],
      lookAt:   [p.x + rx - cosA * AHEAD, p.y, p.z + rz - sinA * AHEAD],
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
    const p = planetLookup(focus.planetId)
    if (s && p) {
      // Position camera on the OPPOSITE side of the ship from the planet,
      // elevated, so the planet stays in background rather than occluding
      // the ship.  Compute the ship→planet direction and step back from it.
      const dx = s.x - p.x
      const dz = s.z - p.z
      const len = Math.hypot(dx, dz) || 1
      const nx = dx / len  // unit vector ship→away-from-planet (x)
      const nz = dz / len  // unit vector ship→away-from-planet (z)
      const BACK = 2.8     // distance behind the ship
      const UP   = 1.8     // height above the ship
      return {
        position: [s.x + nx * BACK, s.y + UP, s.z + nz * BACK],
        lookAt:   [s.x, s.y + 0.1, s.z],
      }
    }
    if (s) {
      return {
        position: [s.x, s.y + 1.8, s.z + 2.8],
        lookAt:   [s.x, s.y, s.z],
      }
    }
  }
  return cameraTargetFor(focus, planetLookup)
}
