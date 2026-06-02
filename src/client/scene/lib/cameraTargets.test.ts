import { describe, it, expect } from 'vitest'
import { cameraTargetFor, cameraTargetForV2 } from './cameraTargets'

describe('cameraTargetFor', () => {
  const planetPos = { x: 6, y: 0, z: 0 }

  it('LOD 0 returns the system overview position', () => {
    const t = cameraTargetFor({ lod: 0 }, () => null)
    expect(t.position).toEqual([0, 8, 24])
    expect(t.lookAt).toEqual([0, 0, 0])
  })

  it('LOD 1 positions the camera radially outward from the sun, looking at the planet', () => {
    const t = cameraTargetFor({ lod: 1, planetId: 1 }, () => planetPos)
    expect(t.lookAt).toEqual([6, 0, 0])
    // Planet at (6,0,0) → sun direction is +X, so camera should be further along +X.
    expect(t.position[0]).toBeGreaterThan(6)
    expect(t.position[2]).toBeCloseTo(0)
    // Camera should be within ~4 units of the planet (close framing).
    const dx = t.position[0] - 6
    const dy = t.position[1]
    const dz = t.position[2]
    expect(Math.hypot(dx, dy, dz)).toBeLessThan(4)
  })

  it('LOD 1 keeps camera on the far side of the sun (no clipping through sun)', () => {
    // Planet at (-6,0,0): camera should be at (-X further), not between sun and planet.
    const t = cameraTargetFor({ lod: 1, planetId: 1 }, () => ({ x: -6, y: 0, z: 0 }))
    expect(t.lookAt).toEqual([-6, 0, 0])
    expect(t.position[0]).toBeLessThan(-6) // camera is farther from origin than planet
    // Distance from origin (sun) must exceed planet's sun-distance.
    expect(Math.hypot(t.position[0], t.position[2])).toBeGreaterThan(6)
  })

  it('LOD 1 sun returns sun-focused position', () => {
    const t = cameraTargetFor({ lod: 1, sun: true }, () => null)
    expect(t.lookAt).toEqual([0, 0, 0])
    expect(t.position[2]).toBeGreaterThan(2)
  })

  it('returns sentinel for LOD 2 (ship positions are dynamic; handled by rig)', () => {
    const t = cameraTargetFor({ lod: 2, planetId: 1, shipFeatureId: 7 }, () => planetPos)
    // For now: ship target is "near the planet" — refined in Phase 10.
    expect(t.lookAt).toEqual([6, 0, 0])
  })
})

describe('cameraTargetForV2', () => {
  it('LOD 2 frames the ship via shipLookup', () => {
    const planetLookup = () => ({ x: 0, y: 0, z: 0 })
    const shipLookup = () => ({ x: 7, y: 0, z: 2 })
    const t = cameraTargetForV2({ lod: 2, planetId: 1, shipFeatureId: 9 }, planetLookup, shipLookup)
    expect(t.lookAt).toEqual([7, 0, 2])
    expect(t.position[0]).toBeCloseTo(8.5) // 7 + 1.5
  })

  it('falls back to planet framing if ship not found at LOD 2', () => {
    const planetLookup = () => ({ x: 5, y: 0, z: 0 })
    const t = cameraTargetForV2({ lod: 2, planetId: 1, shipFeatureId: 99 }, planetLookup, () => null)
    expect(t.lookAt).toEqual([5, 0, 0])
  })
})
