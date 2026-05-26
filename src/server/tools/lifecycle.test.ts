import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { adoptTool, elevateTool, forkTool } from './lifecycle.js'
import { resolveTool } from './resolver.js'
import { scanScopeType } from './scanner.js'
import { clear as clearScanCache } from './scanCache.js'
import type { ToolEntry } from '../../core/tools.js'

function makeEnv() {
  const homeRoot = mkdtempSync(path.join(os.tmpdir(), 'ay-lc-home-'))
  const ship = mkdtempSync(path.join(os.tmpdir(), 'ay-lc-ship-'))
  const prevHome = process.env.AGENTYARD_HOME
  process.env.AGENTYARD_HOME = homeRoot
  clearScanCache()
  return {
    ctx: { planetProjectPath: ship },
    homeRoot,
    planetRoot: path.join(ship, '.agentyard'),
    catalogProjectRoot: path.join(ship, '.claude'),
    cleanup: () => {
      if (prevHome === undefined) delete process.env.AGENTYARD_HOME
      else process.env.AGENTYARD_HOME = prevHome
      clearScanCache()
      rmSync(homeRoot, { recursive: true, force: true })
      rmSync(ship, { recursive: true, force: true })
    },
  }
}

function writeFile(p: string, content: string): void {
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, content, 'utf8')
}

// ── elevate (planet → global) ──

test('elevateTool: moves a per-planet agent file to global; planet copy disappears', async () => {
  const env = makeEnv()
  try {
    writeFile(
      path.join(env.planetRoot, 'agents', 'mover.md'),
      '---\nname: mover\ndescription: original\nrole: mover\ntoolPreset: claude_code\n---\n\nbody\n',
    )
    const source = (await scanScopeType('planet', 'agent', env.ctx)).find(
      (e) => e.data.name === 'mover',
    )
    assert.ok(source, 'precondition: scanner finds planet-scoped agent')

    const { targetPath } = elevateTool(source as ToolEntry, env.ctx)

    assert.ok(existsSync(targetPath), 'global file exists')
    assert.ok(
      targetPath.startsWith(env.homeRoot),
      `target should be inside global root: ${targetPath}`,
    )
    assert.ok(
      !existsSync(path.join(env.planetRoot, 'agents', 'mover.md')),
      'planet-scoped file removed',
    )

    // After elevation, resolveTool sees the global one.
    const resolved = await resolveTool('agent', 'mover', env.ctx)
    assert.ok(resolved && resolved.scope === 'global')
  } finally {
    env.cleanup()
  }
})

test('elevateTool: rejects a source that is not in planet scope', async () => {
  const env = makeEnv()
  try {
    writeFile(
      path.join(env.homeRoot, 'agents', 'wrong.md'),
      '---\nname: wrong\ndescription: \nrole: wrong\ntoolPreset: claude_code\n---\n\nbody\n',
    )
    const source = (await scanScopeType('global', 'agent', env.ctx)).find(
      (e) => e.data.name === 'wrong',
    )
    assert.ok(source)
    assert.throws(() => elevateTool(source as ToolEntry, env.ctx), /'planet' scope/)
  } finally {
    env.cleanup()
  }
})

// ── fork (global → planet copy) ──

test('forkTool: copies a global agent to planet; both files exist; planet wins on resolve', async () => {
  const env = makeEnv()
  try {
    writeFile(
      path.join(env.homeRoot, 'agents', 'forky.md'),
      '---\nname: forky\ndescription: gd\nrole: forky\ntoolPreset: claude_code\n---\n\nglobal body\n',
    )
    const source = (await scanScopeType('global', 'agent', env.ctx)).find(
      (e) => e.data.name === 'forky',
    )
    assert.ok(source)

    const { targetPath } = forkTool(source as ToolEntry, env.ctx)

    assert.ok(targetPath.startsWith(env.planetRoot))
    assert.ok(existsSync(targetPath), 'planet copy exists')
    assert.ok(
      existsSync(path.join(env.homeRoot, 'agents', 'forky.md')),
      'global file is still there (fork = copy, not move)',
    )

    // Resolver now returns planet scope (closer wins).
    const resolved = await resolveTool('agent', 'forky', env.ctx)
    assert.ok(resolved && resolved.scope === 'planet')
  } finally {
    env.cleanup()
  }
})

test('forkTool: copies a global SKILL folder recursively to planet', async () => {
  const env = makeEnv()
  try {
    const srcDir = path.join(env.homeRoot, 'skills', 'forky-skill')
    writeFile(
      path.join(srcDir, 'SKILL.md'),
      '---\nname: forky-skill\ndescription: g\n---\n\nbody\n',
    )
    writeFile(path.join(srcDir, 'extra.txt'), 'sidecar')

    const source = (await scanScopeType('global', 'skill', env.ctx)).find(
      (e) => e.data.name === 'forky-skill',
    )
    assert.ok(source)

    const { targetPath } = forkTool(source as ToolEntry, env.ctx)
    assert.ok(targetPath.startsWith(env.planetRoot))
    assert.ok(existsSync(path.join(targetPath, 'SKILL.md')))
    assert.ok(existsSync(path.join(targetPath, 'extra.txt')), 'recursive copy keeps sidecars')
  } finally {
    env.cleanup()
  }
})

test('forkTool: rejects a source that is not in global scope', async () => {
  const env = makeEnv()
  try {
    writeFile(
      path.join(env.planetRoot, 'agents', 'shippy.md'),
      '---\nname: shippy\ndescription: \nrole: shippy\ntoolPreset: claude_code\n---\n\nbody\n',
    )
    const source = (await scanScopeType('planet', 'agent', env.ctx)).find(
      (e) => e.data.name === 'shippy',
    )
    assert.ok(source)
    assert.throws(() => forkTool(source as ToolEntry, env.ctx), /'global' scope/)
  } finally {
    env.cleanup()
  }
})

// ── adopt (catalog → editable) ──

test('adoptTool: rewrites a Claude-format agent into AgentYard format', async () => {
  const env = makeEnv()
  try {
    // Claude format uses `mcpServers` / `tools` (we rename → `mcps` / `allowedTools`).
    writeFile(
      path.join(env.catalogProjectRoot, 'agents', 'imported.md'),
      [
        '---',
        'name: imported',
        'description: from claude',
        'mcpServers:',
        '  - sentry',
        'tools:',
        '  - Read',
        '  - Bash',
        '---',
        '',
        'You are imported.',
        '',
      ].join('\n'),
    )
    const source = (await scanScopeType('claude-project', 'agent', env.ctx)).find(
      (e) => e.data.name === 'imported',
    )
    assert.ok(source, 'scanner finds the catalog entry')

    const { targetPath } = adoptTool({
      source: source as ToolEntry,
      target: 'planet',
      ctx: env.ctx,
    })
    assert.ok(targetPath.startsWith(env.planetRoot))
    const written = readFileSync(targetPath, 'utf8')
    // Field rename happened.
    assert.match(written, /mcps:\s*\n\s+-\s+sentry/)
    assert.match(written, /allowedTools:\s*\n\s+-\s+Read/)
    // Body preserved.
    assert.match(written, /You are imported\./)
  } finally {
    env.cleanup()
  }
})

test('adoptTool: rejects a source from a non-catalog scope', async () => {
  const env = makeEnv()
  try {
    writeFile(
      path.join(env.planetRoot, 'agents', 'shippy.md'),
      '---\nname: shippy\ndescription: \nrole: shippy\ntoolPreset: claude_code\n---\n\nbody\n',
    )
    const source = (await scanScopeType('planet', 'agent', env.ctx)).find(
      (e) => e.data.name === 'shippy',
    )
    assert.ok(source)
    assert.throws(
      () =>
        adoptTool({
          source: source as ToolEntry,
          target: 'global',
          ctx: env.ctx,
        }),
      /catalog scope/,
    )
  } finally {
    env.cleanup()
  }
})

test('adoptTool: copies a SKILL folder out of the catalog into the editable scope', async () => {
  const env = makeEnv()
  try {
    const src = path.join(env.catalogProjectRoot, 'skills', 'adopted')
    writeFile(
      path.join(src, 'SKILL.md'),
      '---\nname: adopted\ndescription: from claude\n---\n\nadopted body\n',
    )
    const source = (await scanScopeType('claude-project', 'skill', env.ctx)).find(
      (e) => e.data.name === 'adopted',
    )
    assert.ok(source)

    const { targetPath } = adoptTool({
      source: source as ToolEntry,
      target: 'global',
      ctx: env.ctx,
    })
    assert.ok(targetPath.startsWith(env.homeRoot))
    assert.ok(existsSync(path.join(targetPath, 'SKILL.md')))
  } finally {
    env.cleanup()
  }
})
