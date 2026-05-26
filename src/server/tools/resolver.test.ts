import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveTool } from './resolver.js'
import { clear as clearScanCache } from './scanCache.js'

/**
 * Build an isolated environment with separate dirs for the "planet" scope and
 * the "global" scope. AGENTYARD_HOME points global at a temp dir so tests
 * never touch the real ~/.agentyard. Note: AGENTYARD_HOME is the .agentyard
 * dir itself, not its parent.
 */
function makeEnv() {
  const homeRoot = mkdtempSync(path.join(os.tmpdir(), 'ay-home-'))
  const planetDir = mkdtempSync(path.join(os.tmpdir(), 'ay-planet-'))
  const prevHome = process.env.AGENTYARD_HOME
  process.env.AGENTYARD_HOME = homeRoot
  clearScanCache()
  return {
    ctx: { planetProjectPath: planetDir },
    homeRoot,
    planetRoot: path.join(planetDir, '.agentyard'),
    cleanup: () => {
      if (prevHome === undefined) delete process.env.AGENTYARD_HOME
      else process.env.AGENTYARD_HOME = prevHome
      clearScanCache()
      rmSync(homeRoot, { recursive: true, force: true })
      rmSync(planetDir, { recursive: true, force: true })
    },
  }
}

function writeAgentFile(scopeRoot: string, name: string, label: string): void {
  const dir = path.join(scopeRoot, 'agents')
  mkdirSync(dir, { recursive: true })
  const fm = [
    '---',
    `name: ${name}`,
    `description: ${label}`,
    `role: ${name}`,
    'toolPreset: claude_code',
    '---',
    '',
    `prompt body for ${label}`,
    '',
  ].join('\n')
  writeFileSync(path.join(dir, `${name}.md`), fm, 'utf8')
}

function writeSkillFolder(scopeRoot: string, name: string, label: string): void {
  const dir = path.join(scopeRoot, 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${label}\n---\n\nbody-${label}\n`,
    'utf8',
  )
}

test('resolveTool: returns null when nothing matches', async () => {
  const env = makeEnv()
  try {
    const r = await resolveTool('agent', 'nope', env.ctx)
    assert.equal(r, null)
  } finally {
    env.cleanup()
  }
})

test('resolveTool: finds a global-scoped agent', async () => {
  const env = makeEnv()
  try {
    writeAgentFile(env.homeRoot, 'planner', 'global-version')
    const r = await resolveTool('agent', 'planner', env.ctx)
    assert.ok(r)
    assert.equal(r!.type, 'agent')
    assert.equal(r!.scope, 'global')
    assert.equal(r!.data.description, 'global-version')
  } finally {
    env.cleanup()
  }
})

test('resolveTool: planet scope shadows global with the same name', async () => {
  const env = makeEnv()
  try {
    writeAgentFile(env.homeRoot, 'planner', 'global-version')
    writeAgentFile(env.planetRoot, 'planner', 'planet-version')
    const r = await resolveTool('agent', 'planner', env.ctx)
    assert.ok(r)
    assert.equal(r!.scope, 'planet')
    assert.equal(r!.data.description, 'planet-version')
  } finally {
    env.cleanup()
  }
})

test('resolveTool: distinct names resolve from their respective scopes', async () => {
  const env = makeEnv()
  try {
    writeAgentFile(env.homeRoot, 'global-only', 'g')
    writeAgentFile(env.planetRoot, 'planet-only', 's')
    const g = await resolveTool('agent', 'global-only', env.ctx)
    const s = await resolveTool('agent', 'planet-only', env.ctx)
    assert.ok(g && g.scope === 'global')
    assert.ok(s && s.scope === 'planet')
  } finally {
    env.cleanup()
  }
})

test('resolveTool: works across tool types (skill)', async () => {
  const env = makeEnv()
  try {
    writeSkillFolder(env.homeRoot, 'tone', 'global-tone')
    writeSkillFolder(env.planetRoot, 'tone', 'planet-tone')
    const r = await resolveTool('skill', 'tone', env.ctx)
    assert.ok(r && r.type === 'skill')
    assert.equal(r.scope, 'planet')
    assert.equal(r.data.description, 'planet-tone')
  } finally {
    env.cleanup()
  }
})

test('resolveTool: planet without a project path falls back to global only', async () => {
  const homeRoot = mkdtempSync(path.join(os.tmpdir(), 'ay-home-'))
  const prev = process.env.AGENTYARD_HOME
  process.env.AGENTYARD_HOME = homeRoot
  clearScanCache()
  try {
    writeAgentFile(homeRoot, 'planner', 'global')
    const r = await resolveTool('agent', 'planner', { planetProjectPath: null })
    assert.ok(r && r.scope === 'global')
  } finally {
    if (prev === undefined) delete process.env.AGENTYARD_HOME
    else process.env.AGENTYARD_HOME = prev
    clearScanCache()
    rmSync(homeRoot, { recursive: true, force: true })
  }
})

test('resolveTool: catalog scopes (.claude/) are NEVER consulted', async () => {
  // The resolver only walks planet → global. A tool present only in a catalog
  // scope should remain unresolved until adopted.
  const env = makeEnv()
  try {
    const catalogDir = path.join(env.ctx.planetProjectPath, '.claude', 'agents')
    mkdirSync(catalogDir, { recursive: true })
    writeFileSync(
      path.join(catalogDir, 'cataloged.md'),
      '---\nname: cataloged\ndescription: c\n---\n\nbody\n',
      'utf8',
    )
    const r = await resolveTool('agent', 'cataloged', env.ctx)
    assert.equal(r, null)
  } finally {
    env.cleanup()
  }
})
