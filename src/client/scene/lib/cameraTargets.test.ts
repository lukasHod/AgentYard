import { describe, it, expect } from 'vitest'
import { cameraTargetFor, cameraTargetForV2 } from './cameraTargets'

describe('cameraTargetFor', () => {
  const planetPos = { x: 6, y: 0, z: 0 }

  it('LOD 0 returns the system overview position', () => {
    const t = cameraTargetFor({ lod: 0 }, () => null)
    expect(t.position).toEqual([0, 8, 24])
    expect(t.lookAt).toEqual([0, 0, 0])
  })

  it('LOD 1 planet positions the camera offset from the planet', () => {
    const t = cameraTargetFor({ lod: 1, planetId: 1 }, () => planetPos)
    // Camera sits to the side and back of the planet; planet is the lookAt.
    expect(t.lookAt).toEqual([6, 0, 0])
    expect(t.position[0]).toBeCloseTo(6)
    expect(t.position[2]).toBeGreaterThan(2) // pulled back along +z
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

  it('falls back to LOD 1 framing if ship not found at LOD 2', () => {
    const planetLookup = () => ({ x: 5, y: 0, z: 0 })
    const t = cameraTargetForV2({ lod: 2, planetId: 1, shipFeatureId: 99 }, planetLookup, () => null)
    expect(t.lookAt).toEqual([5, 0, 0]) // same as LOD 1 planet
  })
})
