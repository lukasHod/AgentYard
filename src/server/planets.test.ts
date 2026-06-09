import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { pickHasClouds } from './planets.js'

describe('pickHasClouds', () => {
  it('returns true when Math.random() < 0.7', () => {
    mock.method(Math, 'random', () => 0.5)
    assert.equal(pickHasClouds(), true)
    mock.restoreAll()
  })

  it('returns false when Math.random() >= 0.7', () => {
    mock.method(Math, 'random', () => 0.9)
    assert.equal(pickHasClouds(), false)
    mock.restoreAll()
  })

  it('produces a mix of true and false across many calls', () => {
    const results = Array.from({ length: 100 }, () => pickHasClouds())
    assert.ok(results.some(Boolean), 'some planets should have clouds')
    assert.ok(results.some((v) => !v), 'some planets should not have clouds')
  })
})
