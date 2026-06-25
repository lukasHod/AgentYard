import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod/v4'
import { parseDbJson } from './dbJson.js'

test('parseDbJson: parses valid JSON through the provided schema', () => {
  const parsed = parseDbJson(
    'test.values_json',
    '["planner","reviewer"]',
    z.array(z.string()),
  )
  assert.deepEqual(parsed, ['planner', 'reviewer'])
})

test('parseDbJson: includes the DB column name for malformed JSON', () => {
  assert.throws(
    () => parseDbJson('node_runs.outputs_json', '{bad-json', z.record(z.string(), z.string())),
    /Invalid JSON in node_runs\.outputs_json/,
  )
})

test('parseDbJson: includes the DB column name for invalid shape', () => {
  assert.throws(
    () => parseDbJson('terminal_sessions.argv_json', '{"not":"argv"}', z.array(z.string())),
    /Invalid shape in terminal_sessions\.argv_json/,
  )
})
