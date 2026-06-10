import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rootsFor } from './browseFolder.js'

describe('rootsFor', () => {
  it('returns real Windows drives only', { skip: process.platform !== 'win32' }, () => {
    const roots = rootsFor('L:/Projekty/AgentYard')
    assert.ok(roots.length > 0)
    assert.ok(roots.length <= 26)
    assert.ok(roots.every((r) => /^[A-Z]:\\$/i.test(r.path)))
  })

  it('returns the Unix root on non-Windows platforms', { skip: process.platform === 'win32' }, () => {
    assert.deepEqual(rootsFor('/tmp/project'), [{ name: '/', path: '/' }])
  })
})
