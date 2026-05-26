import { describe, it, expect } from 'vitest'
import { derivePlanetParams } from './planetParams'

describe('derivePlanetParams', () => {
  it('is deterministic for the same name', () => {
    const a = derivePlanetParams('AgentYard')
    const b = derivePlanetParams('AgentYard')
    expect(a).toEqual(b)
  })

  it('differs for different names', () => {
    const a = derivePlanetParams('AgentYard')
    const b = derivePlanetParams('Stellar')
    expect(a.surfaceType).not.toBe(b.surfaceType) /* may collide, but extremely unlikely */
    // weaker: at least one of several params differs
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('produces in-range radii', () => {
    for (const name of ['a', 'bb', 'looooong', 'AgentYard', 'foo-bar-baz']) {
      const p = derivePlanetParams(name)
      expect(p.radius).toBeGreaterThanOrEqual(0.8)
      expect(p.radius).toBeLessThanOrEqual(1.2)
      expect(p.paletteHue).toBeGreaterThanOrEqual(0)
      expect(p.paletteHue).toBeLessThan(360)
      expect(['rocky', 'gas', 'lava', 'ice', 'ocean', 'crystal', 'ringed']).toContain(p.surfaceType)
      expect(p.rotationSpeed).toBeGreaterThanOrEqual(0.3)
      expect(p.rotationSpeed).toBeLessThanOrEqual(1.0)
    }
  })

  it('ringed surface always has hasRing=true', () => {
    // Search for a name that hashes to ringed; deterministic so we can pick one.
    let found = false
    for (let i = 0; i < 200; i++) {
      const p = derivePlanetParams(`probe-${i}`)
      if (p.surfaceType === 'ringed') {
        expect(p.hasRing).toBe(true)
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })
})
