import test from 'node:test'
import assert from 'node:assert/strict'
import { createMarkCompleteGate } from './markCompleteGate.js'

test('gate.complete resolves with the result', async () => {
  const gate = createMarkCompleteGate({ nodeId: 'n1' })
  gate.complete({ summary: 'done' })
  const r = await gate.result
  assert.equal(r.summary, 'done')
})

test('gate.notifyClosed rejects when complete was never called', async () => {
  const gate = createMarkCompleteGate({ nodeId: 'n1' })
  gate.notifyClosed()
  await assert.rejects(gate.result, /leader session closed before mark_node_complete/)
})

test('complete after notifyClosed is a no-op (first settle wins)', async () => {
  const gate = createMarkCompleteGate({ nodeId: 'n1' })
  gate.complete({ summary: 'first' })
  gate.notifyClosed()
  const r = await gate.result
  assert.equal(r.summary, 'first')
})

test('timeout rejects the gate', async () => {
  const gate = createMarkCompleteGate({ nodeId: 'slow', timeoutMs: 50 })
  await assert.rejects(gate.result, /timed out after 50ms/)
})

test('complete before timeout wins', async () => {
  const gate = createMarkCompleteGate({ nodeId: 'fast', timeoutMs: 1000 })
  gate.complete({ summary: 'ok' })
  const r = await gate.result
  assert.equal(r.summary, 'ok')
})

test('abort signal rejects the gate', async () => {
  const ctl = new AbortController()
  const gate = createMarkCompleteGate({ nodeId: 'abortable', signal: ctl.signal })
  setTimeout(() => ctl.abort(), 10)
  await assert.rejects(gate.result, /aborted/)
})

test('already-aborted signal rejects immediately', async () => {
  const ctl = new AbortController()
  ctl.abort()
  const gate = createMarkCompleteGate({ nodeId: 'pre-aborted', signal: ctl.signal })
  await assert.rejects(gate.result, /aborted/)
})

test('dispose without settling makes the promise unresolved forever (caller responsibility)', () => {
  // This documents intent: dispose() does NOT settle the promise — it just
  // tears down timers/listeners. The caller (runAINodeOnSessions) only calls
  // dispose() AFTER awaiting result, so the gate is already settled.
  const gate = createMarkCompleteGate({ nodeId: 'n1', timeoutMs: 50 })
  gate.dispose()
  // No assertion: just make sure dispose() doesn't throw and clears the timer
  // so this test doesn't leak a pending timeout.
})
