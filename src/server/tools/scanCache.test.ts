import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanScopeType } from './scanner.js'
import {
  clear as clearScanCache,
  getCached,
  invalidate,
  _setTtlForTests,
} from './scanCache.js'
import { writeTool, deleteTool } from './crud.js'

function makePlanet() {
  const planetDir = mkdtempSync(path.join(os.tmpdir(), 'ay-cache-'))
  clearScanCache()
  return {
    ctx: { planetProjectPath: planetDir },
    cleanup: () => {
      clearScanCache()
      rmSync(planetDir, { recursive: true, force: true })
    },
  }
}

function writeSkill(ctx: { planetProjectPath: string }, name: string, body: string): void {
  const dir = path.join(ctx.planetProjectPath, '.agentyard', 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name}\n---\n\n${body}\n`,
    'utf8',
  )
}

test('scanCache: a second scan hits the cache, not the disk', async () => {
  const env = makePlanet()
  try {
    writeSkill(env.ctx, 'first', 'one')

    const first = await scanScopeType('planet', 'skill', env.ctx)
    assert.equal(first.length, 1)
    assert.equal(first[0]!.data.name, 'first')

    // Direct on-disk edit that the cache must NOT see immediately.
    writeSkill(env.ctx, 'sneaky', 'two')

    const second = await scanScopeType('planet', 'skill', env.ctx)
    assert.equal(second.length, 1, 'cache should serve stale data within TTL')
    assert.equal(second[0]!.data.name, 'first')
    // Underlying cache has the entry.
    assert.ok(getCached('planet', 'skill', env.ctx))
  } finally {
    env.cleanup()
  }
})

test('scanCache: TTL expiry forces a fresh scan', async () => {
  const env = makePlanet()
  const prevTtl = _setTtlForTests(50)
  try {
    writeSkill(env.ctx, 'one', 'a')
    const first = await scanScopeType('planet', 'skill', env.ctx)
    assert.equal(first.length, 1)

    writeSkill(env.ctx, 'two', 'b')
    await new Promise((r) => setTimeout(r, 70))
    const second = await scanScopeType('planet', 'skill', env.ctx)
    assert.equal(second.length, 2)
  } finally {
    _setTtlForTests(prevTtl)
    env.cleanup()
  }
})

test('scanCache: writeTool invalidates the matching scope/type', async () => {
  const env = makePlanet()
  try {
    writeSkill(env.ctx, 'one', 'a')
    const before = await scanScopeType('planet', 'skill', env.ctx)
    assert.equal(before.length, 1)

    // Writing through the API should bust the cache for planet+skill.
    writeTool('planet', 'skill', { name: 'two', description: '', body: 'b' }, env.ctx)

    // Cache for planet+skill is gone; the next scan re-reads.
    assert.equal(getCached('planet', 'skill', env.ctx), undefined)
    const after = await scanScopeType('planet', 'skill', env.ctx)
    assert.equal(after.length, 2)
  } finally {
    env.cleanup()
  }
})

test('scanCache: deleteTool invalidates the matching scope/type', async () => {
  const env = makePlanet()
  try {
    writeTool('planet', 'skill', { name: 'goodbye', description: '', body: 'b' }, env.ctx)
    const before = await scanScopeType('planet', 'skill', env.ctx)
    assert.equal(before.length, 1)

    deleteTool('planet', 'skill', 'goodbye', env.ctx)
    assert.equal(getCached('planet', 'skill', env.ctx), undefined)
    const after = await scanScopeType('planet', 'skill', env.ctx)
    assert.equal(after.length, 0)
  } finally {
    env.cleanup()
  }
})

test('scanCache: invalidate is dimension-scoped — unrelated entries survive', async () => {
  const env = makePlanet()
  try {
    writeTool('planet', 'skill', { name: 'skill1', description: '', body: 'a' }, env.ctx)
    writeTool(
      'planet',
      'agent',
      {
        name: 'agent1',
        description: '',
        role: 'agent1',
        toolPreset: 'claude_code',
        skills: [],
        mcps: [],
        scripts: [],
        prompt: 'p',
      },
      env.ctx,
    )

    // Prime both caches.
    await scanScopeType('planet', 'skill', env.ctx)
    await scanScopeType('planet', 'agent', env.ctx)
    assert.ok(getCached('planet', 'skill', env.ctx))
    assert.ok(getCached('planet', 'agent', env.ctx))

    // Invalidate only skill — agent cache must survive.
    invalidate('planet', 'skill', env.ctx)
    assert.equal(getCached('planet', 'skill', env.ctx), undefined)
    assert.ok(getCached('planet', 'agent', env.ctx), 'agent entry preserved')
  } finally {
    env.cleanup()
  }
})

test('scanCache: clear() drops everything', async () => {
  const env = makePlanet()
  try {
    writeTool('planet', 'skill', { name: 's', description: '', body: 'b' }, env.ctx)
    await scanScopeType('planet', 'skill', env.ctx)
    assert.ok(getCached('planet', 'skill', env.ctx))
    clearScanCache()
    assert.equal(getCached('planet', 'skill', env.ctx), undefined)
  } finally {
    env.cleanup()
  }
})
