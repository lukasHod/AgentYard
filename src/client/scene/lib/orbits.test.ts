import { describe, it, expect } from 'vitest'
import { planetOrbitPositions, ringAngles } from './orbits'

describe('planetOrbitPositions', () => {
  it('places N planets on increasing ring radii', () => {
    const positions = planetOrbitPositions(4, 0, { firstRing: 6, ringGap: 3 })
    expect(positions).toHaveLength(4)
    expect(positions[0]!.radius).toBe(6)
    expect(positions[1]!.radius).toBe(9)
    expect(positions[2]!.radius).toBe(12)
    expect(positions[3]!.radius).toBe(15)
  })

  it('spreads angles for planets sharing a ring (unused but supported)', () => {
    const positions = planetOrbitPositions(4, Math.PI / 6, { firstRing: 6, ringGap: 3 })
    expect(positions[0]!.angle).toBe(Math.PI / 6)
  })
})

describe('ringAngles', () => {
  it('returns N evenly spaced angles', () => {
    const a = ringAngles(4)
    expect(a).toEqual([0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2])
  })
  it('returns single angle 0 for N=1', () => {
    expect(ringAngles(1)).toEqual([0])
  })
  it('returns empty for N=0', () => {
    expect(ringAngles(0)).toEqual([])
  })
})
