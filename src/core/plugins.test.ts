import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentEventSchema, type AgentEvent } from './plugins.js'

test('AgentEventSchema parses every event variant round-trip', () => {
  const samples: AgentEvent[] = [
    { type: 'assistant_message', text: 'hi', ts: 1 },
    { type: 'user_message_echo', text: 'yo', ts: 2 },
    { type: 'system', text: 'init', ts: 3 },
    {
      type: 'tool_use',
      tool: 'mcp__ay_runtime__request_clarification',
      toolUseId: 'tu_1',
      input: { question: 'color?' },
      ts: 4,
    },
    {
      type: 'tool_result',
      tool: 'mcp__ay_runtime__request_clarification',
      toolUseId: 'tu_1',
      output: 'blue',
      isError: false,
      ts: 5,
    },
    { type: 'state', state: 'working', ts: 6 },
    { type: 'needs_input', question: 'pick one', toolUseId: 'tu_2', ts: 7 },
    { type: 'cost', inputTokens: 100, outputTokens: 50, ts: 8 },
    { type: 'error', message: 'boom', ts: 9 },
    { type: 'exited', code: 0, ts: 10 },
    { type: 'exited', code: null, reason: 'runtime_lost', ts: 11 },
  ]

  for (const ev of samples) {
    const parsed = AgentEventSchema.parse(ev)
    assert.deepEqual(parsed, ev, `round-trip failed for type=${ev.type}`)
  }
})

test('AgentEventSchema rejects unknown event types', () => {
  // `as unknown` is the safe escape hatch — we intentionally feed invalid data.
  const bad = { type: 'whoosh', ts: 1 } as unknown
  assert.throws(() => AgentEventSchema.parse(bad))
})

test('AgentEventSchema rejects invalid lifecycle state value', () => {
  const bad = { type: 'state', state: 'flying', ts: 1 } as unknown
  assert.throws(() => AgentEventSchema.parse(bad))
})

test('AgentEventSchema requires both text and ts on text events', () => {
  const missingText = { type: 'assistant_message', ts: 1 } as unknown
  assert.throws(() => AgentEventSchema.parse(missingText))

  const missingTs = { type: 'assistant_message', text: 'hi' } as unknown
  assert.throws(() => AgentEventSchema.parse(missingTs))
})
