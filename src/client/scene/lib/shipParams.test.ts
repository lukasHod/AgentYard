import { describe, it, expect } from 'vitest'
import { deriveShipParams } from './shipParams'
import { SHIP_MODELS } from './shipModels'

describe('deriveShipParams', () => {
  it('is deterministic for same (id, name)', () => {
    const a = deriveShipParams(7, 'add-payment-flow')
    const b = deriveShipParams(7, 'add-payment-flow')
    expect(a).toEqual(b)
  })

  it('returns a modelIndex within the SHIP_MODELS range and a valid url', () => {
    for (let i = 0; i < 50; i++) {
      const p = deriveShipParams(i, `feat-${i}`)
      expect(p.modelIndex).toBeGreaterThanOrEqual(0)
      expect(p.modelIndex).toBeLessThan(SHIP_MODELS.length)
      expect(p.modelUrl).toBe(SHIP_MODELS[p.modelIndex]!.url)
      expect(p.hueShift).toBeGreaterThanOrEqual(0)
      expect(p.hueShift).toBeLessThan(360)
    }
  })

  it('hueShift varies across many inputs', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 50; i++) seen.add(deriveShipParams(i, `feat-${i}`).hueShift)
    expect(seen.size).toBeGreaterThan(20) // 50 inputs → at least 20 distinct hues
  })
})
