import { describe, it, expect } from 'vitest'
import { getCircleRadius, getPlanetState, PANEL_SIZE, PANEL_GAP } from './PlanetDashboard'

describe('getCircleRadius', () => {
  it('returns minimum 220 for small counts', () => {
    expect(getCircleRadius(1)).toBe(220)
    expect(getCircleRadius(2)).toBe(220)
  })

  it('grows beyond 220 when 8 panels would overlap at minimum', () => {
    // circumference = 8 * (150 + 28) = 1424 → r ≈ 226.6 > 220
    expect(getCircleRadius(8)).toBeGreaterThan(220)
  })

  it('is monotonically non-decreasing for counts 1–8', () => {
    let prev = getCircleRadius(1)
    for (let n = 2; n <= 8; n++) {
      const cur = getCircleRadius(n)
      expect(cur).toBeGreaterThanOrEqual(prev)
      prev = cur
    }
  })

  it('uses PANEL_SIZE and PANEL_GAP constants in its formula', () => {
    // For count=9 the formula should dominate over the 220 minimum
    const circumference = 9 * (PANEL_SIZE + PANEL_GAP)
    const expected = circumference / (2 * Math.PI)
    expect(getCircleRadius(9)).toBeCloseTo(expected, 5)
  })
})

describe('getPlanetState', () => {
  it('returns idle when planet has no features and is not pending', () => {
    expect(getPlanetState(1, new Map(), new Set())).toBe('idle')
  })

  it('returns idle when all features are complete', () => {
    const features = new Map([[1, [{ status: 'complete' }, { status: 'failed' }]]])
    expect(getPlanetState(1, features, new Set())).toBe('idle')
  })

  it('returns running when any feature has status running', () => {
    const features = new Map([[1, [{ status: 'complete' }, { status: 'running' }]]])
    expect(getPlanetState(1, features, new Set())).toBe('running')
  })

  it('returns pending when planet id is in the pending set', () => {
    expect(getPlanetState(1, new Map(), new Set([1]))).toBe('pending')
  })

  it('pending takes priority over running', () => {
    const features = new Map([[1, [{ status: 'running' }]]])
    expect(getPlanetState(1, features, new Set([1]))).toBe('pending')
  })

  it('returns idle when planet id is not in features map', () => {
    const features = new Map([[2, [{ status: 'running' }]]])
    expect(getPlanetState(99, features, new Set())).toBe('idle')
  })
})
