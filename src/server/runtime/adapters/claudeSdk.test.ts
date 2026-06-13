import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '../Session.js'
import {
  CLAUDE_SDK_CAPABILITIES,
  ClaudeSdkAdapter,
  sessionEventToAgentEvent,
} from './claudeSdk.js'

test('ClaudeSdkAdapter advertises stable capabilities', () => {
  const adapter = new ClaudeSdkAdapter()
  assert.equal(adapter.kind, 'claude-sdk')
  assert.equal(adapter.runtime, 'sdk')
  assert.equal(adapter.capabilities, CLAUDE_SDK_CAPABILITIES)
  assert.equal(adapter.capabilities.supports_tools, true)
  assert.equal(adapter.capabilities.supports_clarification_tool, true)
  assert.equal(adapter.capabilities.supports_resume, false)
})

test('sessionEventToAgentEvent: assistant message', () => {
  const ev: SessionEvent = {
    type: 'message',
    agentRunId: 'a-1',
    message: { role: 'assistant', text: 'hello', timestamp: 1234 },
  }
  assert.deepEqual(sessionEventToAgentEvent(ev), {
    type: 'assistant_message',
    text: 'hello',
    ts: 1234,
  })
})

test('sessionEventToAgentEvent: user message echoes as user_message_echo', () => {
  const ev: SessionEvent = {
    type: 'message',
    agentRunId: 'a-1',
    message: { role: 'user', text: 'hi', timestamp: 2 },
  }
  assert.deepEqual(sessionEventToAgentEvent(ev), {
    type: 'user_message_echo',
    text: 'hi',
    ts: 2,
  })
})

test('sessionEventToAgentEvent: system message stays system', () => {
  const ev: SessionEvent = {
    type: 'message',
    agentRunId: 'a-1',
    message: { role: 'system', text: '[error] boom', timestamp: 3 },
  }
  assert.deepEqual(sessionEventToAgentEvent(ev), {
    type: 'system',
    text: '[error] boom',
    ts: 3,
  })
})

test('sessionEventToAgentEvent: chat state -> lifecycle state', () => {
  const cases: Array<[SessionEvent['type'] extends 'state' ? never : never] | never[]> = []
  void cases
  const tests: Array<[
    'idle' | 'thinking' | 'tool_running' | 'awaiting_clarification' | 'done' | 'failed',
    'idle' | 'working' | 'needs_input' | 'done' | 'terminated',
  ]> = [
    ['idle', 'idle'],
    ['thinking', 'working'],
    ['tool_running', 'working'],
    ['awaiting_clarification', 'needs_input'],
    ['done', 'done'],
    ['failed', 'terminated'],
  ]
  for (const [chat, lifecycle] of tests) {
    const ev: SessionEvent = { type: 'state', agentRunId: 'a-1', state: chat }
    const out = sessionEventToAgentEvent(ev)
    assert.ok(out, `expected non-null translation for chat state ${chat}`)
    assert.equal(out.type, 'state')
    if (out.type === 'state') assert.equal(out.state, lifecycle, `chat=${chat}`)
  }
})

test('sessionEventToAgentEvent: clarification:requested -> needs_input', () => {
  const ev: SessionEvent = {
    type: 'clarification:requested',
    agentRunId: 'a-1',
    req: { id: 'tu-9', question: 'pick a color' },
  }
  const out = sessionEventToAgentEvent(ev)
  assert.ok(out)
  assert.equal(out.type, 'needs_input')
  if (out.type === 'needs_input') {
    assert.equal(out.question, 'pick a color')
    assert.equal(out.toolUseId, 'tu-9')
  }
})

test('sessionEventToAgentEvent: clarification:resolved is dropped', () => {
  const ev: SessionEvent = {
    type: 'clarification:resolved',
    agentRunId: 'a-1',
    id: 'tu-9',
  }
  assert.equal(sessionEventToAgentEvent(ev), null)
})

test('sessionEventToAgentEvent: closed is dropped (handled by handle)', () => {
  const ev: SessionEvent = { type: 'closed', agentRunId: 'a-1' }
  assert.equal(sessionEventToAgentEvent(ev), null)
})
