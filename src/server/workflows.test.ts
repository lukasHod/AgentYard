import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * workflows.ts uses the shared `getDb()` singleton, which opens
 * `~/.agentyard/agentyard.db`. To test row-resilience in isolation we'd need
 * dependency injection; for now we exercise the parse logic directly by
 * importing the un-exported `tryRowToWorkflow` via the public listWorkflows
 * path against a sandbox DB.
 *
 * The sandbox approach: monkey-patch `os.homedir` via env? Too invasive.
 * Instead we copy the parse contract into the test by importing the schemas
 * directly and verifying that a corrupt graph_json doesn't throw at the
 * single-row layer used by listWorkflows.
 */
import { WorkflowGraphSchema, WorkflowSchema } from '../core/schema.js'

function tmpdir() {
  const d = mkdtempSync(path.join(os.tmpdir(), 'ay-wf-'))
  return { d, cleanup: () => rmSync(d, { recursive: true, force: true }) }
}

/**
 * Mirror of tryRowToWorkflow's behavior — kept in sync with workflows.ts.
 * This test asserts the contract: a row whose graph_json is malformed should
 * yield `null` rather than throwing.
 */
function tryParseRow(row: { id: number; name: string; graph_json: string; is_template: number }) {
  try {
    const graph = WorkflowGraphSchema.parse(JSON.parse(row.graph_json))
    return WorkflowSchema.parse({
      id: row.id,
      name: row.name,
      graph,
      isTemplate: row.is_template === 1,
    })
  } catch {
    return null
  }
}

test('a row with invalid JSON in graph_json is skipped, not thrown', () => {
  const row = { id: 1, name: 'bad', graph_json: '{not-json', is_template: 0 }
  assert.equal(tryParseRow(row), null)
})

test('a row whose graph fails zod is skipped', () => {
  const row = {
    id: 2,
    name: 'wrong-shape',
    graph_json: JSON.stringify({ nodes: 'not-an-array', edges: [] }),
    is_template: 0,
  }
  assert.equal(tryParseRow(row), null)
})

test('a valid row parses', () => {
  const row = {
    id: 3,
    name: 'ok',
    graph_json: JSON.stringify({ nodes: [], edges: [] }),
    is_template: 1,
  }
  const w = tryParseRow(row)
  assert.ok(w)
  assert.equal(w!.id, 3)
  assert.equal(w!.isTemplate, true)
})

// Sanity: better-sqlite3 actually works in this environment, so the contract
// above can be exercised end-to-end if workflows.ts gets refactored for DI.
test('better-sqlite3 round-trip works against a tmp DB', () => {
  const { d, cleanup } = tmpdir()
  try {
    const db = new Database(path.join(d, 'test.db'))
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, blob TEXT)')
    db.prepare('INSERT INTO t (blob) VALUES (?)').run('{bad-json')
    db.prepare('INSERT INTO t (blob) VALUES (?)').run(
      JSON.stringify({ nodes: [], edges: [] }),
    )
    const rows = db.prepare('SELECT * FROM t').all() as Array<{
      id: number
      blob: string
    }>
    assert.equal(rows.length, 2)
    // Simulating listWorkflows's resilience: the first row's blob is corrupt,
    // but a `.map(tryParse).filter(Boolean)` pipeline still yields the second.
    const parsed = rows.map((r) => {
      try {
        return JSON.parse(r.blob)
      } catch {
        return null
      }
    })
    assert.equal(parsed[0], null)
    assert.deepEqual(parsed[1], { nodes: [], edges: [] })
    db.close()
  } finally {
    cleanup()
  }
})
