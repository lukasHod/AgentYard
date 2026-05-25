import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertValidToolName,
  isValidToolName,
  ToolNameSchema,
  SkillToolSchema,
  AgentToolSchema,
} from './tools.js'

test('isValidToolName accepts normal names', () => {
  for (const n of ['foo', 'Foo-Bar', 'foo.bar', 'foo_bar', 'a1.b2', 'a', 'X', 'agent-1', '0name']) {
    assert.equal(isValidToolName(n), true, `${n} should be valid`)
  }
})

test('isValidToolName rejects path-escape attempts', () => {
  for (const n of [
    '..',
    '../etc',
    'foo/bar',
    'foo\\bar',
    'a..b',
    '.hidden',
    '',
    '-leading-dash',
    '_leading-underscore',
    '.leading-dot',
    'with space',
    'name\nnewline',
    'name;evil',
  ]) {
    assert.equal(isValidToolName(n), false, `${JSON.stringify(n)} should be invalid`)
  }
})

test('isValidToolName enforces length cap', () => {
  assert.equal(isValidToolName('a'.repeat(64)), true)
  assert.equal(isValidToolName('a'.repeat(65)), false)
})

test('assertValidToolName throws with the offending value visible', () => {
  assert.throws(() => assertValidToolName('../etc'), /\.\.\/etc/)
})

test('ToolNameSchema parse fails for traversal', () => {
  assert.equal(ToolNameSchema.safeParse('../etc').success, false)
  assert.equal(ToolNameSchema.safeParse('foo/bar').success, false)
  assert.equal(ToolNameSchema.safeParse('good-name').success, true)
})

test('SkillToolSchema gates name field', () => {
  assert.equal(
    SkillToolSchema.safeParse({ name: '../foo', description: '', body: '' }).success,
    false,
  )
  assert.equal(
    SkillToolSchema.safeParse({ name: 'ok', description: '', body: '' }).success,
    true,
  )
})

test('AgentToolSchema gates name field', () => {
  assert.equal(
    AgentToolSchema.safeParse({ name: 'foo/bar', description: '', role: '' }).success,
    false,
  )
})
