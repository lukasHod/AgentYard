import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pickHasClouds } from './planets.js'

describe('pickHasClouds', () => {
  it('is deterministic for the same name', () => {
    assert.equal(pickHasClouds('AgentYard'), pickHasClouds('AgentYard'))
  })

  it('gas planets never have clouds', () => {
    let gasFound = false
    for (let i = 0; i < 500; i++) {
      const name = `probe-${i}`
      let h = 0x811c9dc5
      for (let j = 0; j < name.length; j++) {
        h ^= name.charCodeAt(j)
        h = Math.imul(h, 0x01000193) >>> 0
      }
      const surfaces = ['rocky', 'gas', 'lava', 'ice', 'ocean', 'crystal', 'ringed']
      const surfaceType = surfaces[((h >>> 8) & 0xff) % surfaces.length]
      if (surfaceType === 'gas') {
        assert.equal(pickHasClouds(name), false, `gas planet ${name} must not have clouds`)
        gasFound = true
      }
    }
    assert.ok(gasFound, 'expected to find at least one gas planet in 500 probes')
  })

  it('produces a mix of true and false across many planet names', () => {
    const results = Array.from({ length: 200 }, (_, i) => pickHasClouds(`planet-${i}`))
    assert.ok(results.some(Boolean), 'some planets should have clouds')
    assert.ok(results.some((v) => !v), 'some planets should not have clouds')
  })
})
