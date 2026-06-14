import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TypedIOServer } from './socketTypes.js'
import { RunRegistry } from './runState.js'

/** Fake socket.io server — just records emitted events. */
function fakeIo(): TypedIOServer & { events: Array<{ name: string; payload: unknown }> } {
  const events: Array<{ name: string; payload: unknown }> = []
  const io = {
    emit(name: string, payload: unknown) {
      events.push({ name, payload })
      return io as unknown as TypedIOServer
    },
  } as unknown as TypedIOServer & { events: typeof events }
  ;(io as { events: typeof events }).events = events
  return io
}

test('beginRun: tracks multiple runs keyed by runId', () => {
  const reg = new RunRegistry(fakeIo())
  const c1 = new AbortController()
  const c2 = new AbortController()
  reg.beginRun({
    runId: 'r1',
    task: 't1',
    featureId: 1,
    planetId: 10,
    controller: c1,
    promise: new Promise(() => {}),
  })
  reg.beginRun({
    runId: 'r2',
    task: 't2',
    featureId: 2,
    planetId: 10,
    controller: c2,
    promise: new Promise(() => {}),
  })
  assert.equal(reg.allSnapshots().length, 2)
  assert.equal(reg.snapshotById('r1')?.featureId, 1)
  assert.equal(reg.snapshotById('r2')?.featureId, 2)
})

test('hasInFlightForFeature: only matches the relevant feature', () => {
  const reg = new RunRegistry(fakeIo())
  reg.beginRun({
    runId: 'r1',
    task: 't',
    featureId: 1,
    controller: new AbortController(),
    promise: new Promise(() => {}),
  })
  assert.equal(reg.hasInFlightForFeature(1), true)
  assert.equal(reg.hasInFlightForFeature(2), false)
})

test('canBegin: rejects when feature already has an in-flight run', () => {
  const reg = new RunRegistry(fakeIo())
  reg.beginRun({
    runId: 'r1',
    task: 't',
    featureId: 1,
    controller: new AbortController(),
    promise: new Promise(() => {}),
  })
  const verdict = reg.canBegin({ featureId: 1 })
  assert.equal(verdict.ok, false)
  if (!verdict.ok) assert.equal(verdict.reason, 'feature-in-flight')
})

test('canBegin: enforces planet capacity', () => {
  const reg = new RunRegistry(fakeIo(), { maxRunsPerPlanet: 2, maxRunsGlobal: 0 })
  for (const i of [1, 2]) {
    reg.beginRun({
      runId: `r${i}`,
      task: 't',
      featureId: i,
      planetId: 10,
      controller: new AbortController(),
      promise: new Promise(() => {}),
    })
  }
  const verdict = reg.canBegin({ featureId: 3, planetId: 10 })
  assert.equal(verdict.ok, false)
  if (!verdict.ok) assert.equal(verdict.reason, 'planet-capacity')

  // A different planet has its own budget.
  assert.equal(reg.canBegin({ featureId: 3, planetId: 11 }).ok, true)
})

test('canBegin: enforces global capacity', () => {
  const reg = new RunRegistry(fakeIo(), { maxRunsPerPlanet: 0, maxRunsGlobal: 1 })
  reg.beginRun({
    runId: 'r1',
    task: 't',
    featureId: 1,
    controller: new AbortController(),
    promise: new Promise(() => {}),
  })
  const verdict = reg.canBegin({ featureId: 2 })
  assert.equal(verdict.ok, false)
  if (!verdict.ok) assert.equal(verdict.reason, 'global-capacity')
})

test('emit: run:started populates nodeStates', () => {
  const io = fakeIo()
  const reg = new RunRegistry(io)
  reg.beginRun({
    runId: 'r1',
    task: 't',
    controller: new AbortController(),
    promise: new Promise(() => {}),
  })
  reg.emit({ type: 'run:started', runId: 'r1', task: 't', nodeIds: ['a', 'b'] })
  const snap = reg.snapshotById('r1')!
  assert.deepEqual(snap.nodeIds, ['a', 'b'])
  assert.equal(snap.nodeStates.a, 'pending')
  assert.equal(snap.nodeStates.b, 'pending')
  assert.equal(io.events.length, 1)
  assert.equal(io.events[0]?.name, 'run:started')
})

test('emit: legacy "pending-*" placeholder is upgraded by first run:started', () => {
  const reg = new RunRegistry(fakeIo())
  reg.begin('legacy', new AbortController(), new Promise(() => {}))
  // Capture by value — `reg.snapshot()` returns the live entry object, which
  // gets mutated in place by emit().
  const placeholderId = reg.snapshot()!.runId
  assert.ok(placeholderId.startsWith('pending-'))

  reg.emit({ type: 'run:started', runId: 'real-uuid', task: 'legacy', nodeIds: ['x'] })
  // The placeholder snapshot should now live under the real runId.
  assert.equal(reg.snapshotById('real-uuid')?.task, 'legacy')
  assert.equal(reg.snapshotById(placeholderId), undefined)
  assert.equal(reg.snapshot()?.runId, 'real-uuid')
})

test('abortRun: cancels the controller', async () => {
  const reg = new RunRegistry(fakeIo())
  const controller = new AbortController()
  let resolved = false
  const promise = new Promise<void>((resolve) => {
    controller.signal.addEventListener('abort', () => {
      resolved = true
      resolve()
    })
  })
  reg.beginRun({
    runId: 'r1',
    task: 't',
    controller,
    promise,
  })
  await reg.abortRun('r1')
  assert.equal(resolved, true)
})

test('reset: aborts every run and clears the registry', async () => {
  const reg = new RunRegistry(fakeIo())
  for (const id of ['r1', 'r2']) {
    const controller = new AbortController()
    reg.beginRun({
      runId: id,
      task: 't',
      controller,
      promise: new Promise<void>((resolve) => controller.signal.addEventListener('abort', () => resolve())),
    })
  }
  await reg.reset()
  assert.equal(reg.allSnapshots().length, 0)
  assert.equal(reg.snapshot(), null)
  assert.equal(reg.isInFlight(), false)
})

test('legacy compatibility: isInFlight + snapshot mirror the last begun run', () => {
  const reg = new RunRegistry(fakeIo())
  reg.begin('legacy', new AbortController(), new Promise(() => {}))
  assert.equal(reg.isInFlight(), true)
  const snap = reg.snapshot()
  assert.ok(snap)
  assert.equal(snap.task, 'legacy')
})
