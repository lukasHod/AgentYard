import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deleteTool, writeTool } from './crud.js'

interface Tmp {
  ctx: { shipProjectPath: string }
  cleanup: () => void
}

function makeTmp(): Tmp {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ay-crud-'))
  return {
    ctx: { shipProjectPath: dir },
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // best effort
      }
    },
  }
}

test('writeTool rejects path-traversal name (skill)', () => {
  const { ctx, cleanup } = makeTmp()
  try {
    assert.throws(
      () =>
        writeTool(
          'ship',
          'skill',
          { name: '../escape', description: '', body: '' },
          ctx,
        ),
      /Invalid tool name/,
    )
  } finally {
    cleanup()
  }
})

test('writeTool rejects names with path separators', () => {
  const { ctx, cleanup } = makeTmp()
  try {
    assert.throws(
      () =>
        writeTool('ship', 'skill', { name: 'foo/bar', description: '', body: '' }, ctx),
      /Invalid tool name/,
    )
    assert.throws(
      () =>
        writeTool('ship', 'skill', { name: 'foo\\bar', description: '', body: '' }, ctx),
      /Invalid tool name/,
    )
  } finally {
    cleanup()
  }
})

test('writeTool accepts a valid name and writes inside the ship root', () => {
  const { ctx, cleanup } = makeTmp()
  try {
    const target = writeTool(
      'ship',
      'skill',
      { name: 'good-skill', description: 'd', body: 'b' },
      ctx,
    )
    // Must land under the ship's .agentyard folder, NOT outside.
    const root = path.join(ctx.shipProjectPath, '.agentyard')
    assert.ok(
      target.startsWith(root + path.sep) || target === root,
      `target ${target} should be inside ${root}`,
    )
    const skillMd = path.join(target, 'SKILL.md')
    assert.ok(existsSync(skillMd), 'SKILL.md should exist')
    const contents = readFileSync(skillMd, 'utf8')
    assert.match(contents, /name: "?good-skill"?/)
  } finally {
    cleanup()
  }
})

test('deleteTool rejects path-traversal name', () => {
  const { ctx, cleanup } = makeTmp()
  try {
    assert.throws(
      () => deleteTool('ship', 'skill', '../escape', ctx),
      /Invalid tool name/,
    )
  } finally {
    cleanup()
  }
})

test('writeTool refuses read-only scopes', () => {
  const { ctx, cleanup } = makeTmp()
  try {
    assert.throws(
      () =>
        writeTool(
          'claude-project' as never,
          'skill',
          { name: 'whatever', description: '', body: '' },
          ctx,
        ),
      /read-only/,
    )
  } finally {
    cleanup()
  }
})
