import { describe, it, expect } from 'vitest'
import { cameraTargetFor, cameraTargetForV2 } from './cameraTargets'

describe('cameraTargetFor', () => {
  const planetPos = { x: 6, y: 0, z: 0 }

  it('LOD 0 returns the system overview position', () => {
    const t = cameraTargetFor({ lod: 0 }, () => null)
    expect(t.position).toEqual([0, 8, 24])
    expect(t.lookAt).toEqual([0, 0, 0])
  })

  it('LOD 1 places the camera at a fixed offset behind+above the planet (parallel follow)', () => {
    const t = cameraTargetFor({ lod: 1, planetId: 1 }, () => planetPos)
    expect(t.position[0]).toBeCloseTo(6)
    expect(t.position[1]).toBeGreaterThan(0) // slight elevation
    expect(t.position[2]).toBeGreaterThan(0) // pulled back along +z
    // Camera should be close to the planet (cinematic frame).
    const dx = t.position[0] - 6
    const dy = t.position[1]
    const dz = t.position[2]
    expect(Math.hypot(dx, dy, dz)).toBeLessThan(3)
  })

  it('LOD 1 lookAt is offset to the LEFT of the planet so the planet renders right-of-centre', () => {
    const t = cameraTargetFor({ lod: 1, planetId: 1 }, () => planetPos)
    // LookAt.x should be less than the planet's x (a point to the planet's -X side).
    expect(t.lookAt[0]).toBeLessThan(6)
    expect(t.lookAt[1]).toBeCloseTo(0)
    expect(t.lookAt[2]).toBeCloseTo(0)
  })

  it('LOD 1 camera stays clear of the sun even at the worst orbital phase', () => {
    // Planet at (0,0,-6) puts the camera at roughly (0,1.5,-3.5). Origin-distance
    // must remain comfortably greater than the sun's radius (~2.4).
    const t = cameraTargetFor({ lod: 1, planetId: 1 }, () => ({ x: 0, y: 0, z: -6 }))
    expect(Math.hypot(t.position[0], t.position[1], t.position[2])).toBeGreaterThan(2.5)
  })

  it('LOD 1 sun returns sun-focused position', () => {
    const t = cameraTargetFor({ lod: 1, sun: true }, () => null)
    expect(t.lookAt).toEqual([0, 0, 0])
    expect(t.position[2]).toBeGreaterThan(2)
  })

  it('returns sentinel for LOD 2 (ship positions are dynamic; handled by rig)', () => {
    const t = cameraTargetFor({ lod: 2, planetId: 1, shipFeatureId: 7 }, () => planetPos)
    // LookAt is the same off-centre target as LOD 1 (lookAt offset is shared).
    expect(t.lookAt[0]).toBeLessThan(6)
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
    expect(t.lookAt[0]).toBeLessThan(5)
  })
})
