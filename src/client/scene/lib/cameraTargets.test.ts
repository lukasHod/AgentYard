import { describe, it, expect } from 'vitest'
import { cameraTargetFor } from './cameraTargets'

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
