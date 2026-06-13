import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeDb, getDb, setDbPathForTesting } from './db.js'
import {
  appendEventAndUpdateSession,
  appendRunnerEvent,
  createNodeRun,
  createRun,
  createRunnerSession,
  deleteRunnerSession,
  getActiveRunForFeature,
  getNodeRun,
  getRun,
  getRunnerSession,
  listNodeRunsForRun,
  listNonTerminalRunnerSessions,
  listRunnerEvents,
  listRunsForFeature,
  updateNodeRun,
  updateRun,
  updateRunnerSession,
} from './runStore.js'

let tmp: string

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ay-runstore-'))
  setDbPathForTesting(path.join(tmp, 'agentyard.db'))
})

after(() => {
  setDbPathForTesting(null)
  closeDb()
  rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
  // Fresh schema between tests — clear every Phase-4 table plus features
  // (which runs FK-references). Order matters for the FK chain.
  const db = getDb()
  db.exec(`
    DELETE FROM runner_events;
    DELETE FROM runner_sessions;
    DELETE FROM node_runs;
    DELETE FROM runs;
    DELETE FROM features;
  `)
  db.prepare(
    `INSERT INTO features (id, planet_id, name, task, status, workflow_id, created_at)
     VALUES (1, 1, 'feat-1', 't', 'idle', 1, ?)`,
  ).run(Date.now())
})

test('createRun + getRun: round-trip', () => {
  const run = createRun({
    featureId: 1,
    workflowId: 1,
    task: 'do the thing',
    agentKind: 'claude-sdk',
    cwd: '/tmp/wt',
  })
  assert.ok(run.id)
  assert.equal(run.featureId, 1)
  assert.equal(run.state, 'not_started')
  const fetched = getRun(run.id)
  assert.deepEqual(fetched, run)
})

test('updateRun: state transition bumps updated_at', async () => {
  const run = createRun({
    featureId: 1,
    workflowId: 1,
    task: 't',
    agentKind: 'claude-sdk',
  })
  const t0 = run.updatedAt
  await new Promise((r) => setTimeout(r, 5))
  const updated = updateRun(run.id, { state: 'working' })
  assert.ok(updated)
  assert.equal(updated.state, 'working')
  assert.ok(updated.updatedAt > t0, 'updated_at should increase')
})

test('getActiveRunForFeature: ignores terminal runs', () => {
  const r1 = createRun({ featureId: 1, workflowId: 1, task: 'a', agentKind: 'claude-sdk' })
  updateRun(r1.id, { state: 'done' })
  assert.equal(getActiveRunForFeature(1), undefined)

  const r2 = createRun({ featureId: 1, workflowId: 1, task: 'b', agentKind: 'claude-sdk' })
  const active = getActiveRunForFeature(1)
  assert.ok(active)
  assert.equal(active.id, r2.id)
})

test('listRunsForFeature: returns DESC by created_at', async () => {
  const r1 = createRun({ featureId: 1, workflowId: 1, task: 'a', agentKind: 'claude-sdk' })
  await new Promise((r) => setTimeout(r, 2))
  const r2 = createRun({ featureId: 1, workflowId: 1, task: 'b', agentKind: 'claude-sdk' })
  const list = listRunsForFeature(1)
  assert.equal(list.length, 2)
  assert.equal(list[0]?.id, r2.id)
  assert.equal(list[1]?.id, r1.id)
})

test('node_runs: outputs JSON round-trip', () => {
  const run = createRun({ featureId: 1, workflowId: 1, task: 't', agentKind: 'claude-sdk' })
  const nr = createNodeRun({ runId: run.id, nodeId: 'analyze', title: 'Analyze' })
  const outputs = { plan: 'three bullets', risks: 'none' }
  updateNodeRun(nr.id, { state: 'complete', summary: 'ok', outputs })
  const fetched = getNodeRun(nr.id)
  assert.ok(fetched)
  assert.equal(fetched.state, 'complete')
  assert.deepEqual(fetched.outputs, outputs)
})

test('listNodeRunsForRun: filters to the right run', () => {
  const a = createRun({ featureId: 1, workflowId: 1, task: 'a', agentKind: 'claude-sdk' })
  const b = createRun({ featureId: 1, workflowId: 1, task: 'b', agentKind: 'claude-sdk' })
  createNodeRun({ runId: a.id, nodeId: 'n1', title: 'N1' })
  createNodeRun({ runId: a.id, nodeId: 'n2', title: 'N2' })
  createNodeRun({ runId: b.id, nodeId: 'n3', title: 'N3' })
  assert.equal(listNodeRunsForRun(a.id).length, 2)
  assert.equal(listNodeRunsForRun(b.id).length, 1)
})

test('runner_sessions: create + update', () => {
  const session = createRunnerSession({
    id: 'sess-1',
    agentKind: 'claude-sdk',
    runtimeKind: 'sdk',
    role: 'leader',
    featureId: 1,
    cwd: '/tmp/wt',
  })
  assert.equal(session.state, 'not_started')

  updateRunnerSession('sess-1', { state: 'working' })
  const after = getRunnerSession('sess-1')
  assert.equal(after?.state, 'working')
})

test('listNonTerminalRunnerSessions: ignores done/terminated', () => {
  createRunnerSession({
    id: 's-active',
    agentKind: 'claude-sdk',
    runtimeKind: 'sdk',
    role: 'free',
  })
  createRunnerSession({
    id: 's-done',
    agentKind: 'claude-sdk',
    runtimeKind: 'sdk',
    role: 'free',
  })
  updateRunnerSession('s-done', { state: 'done' })
  const list = listNonTerminalRunnerSessions()
  assert.equal(list.length, 1)
  assert.equal(list[0]?.id, 's-active')
})

test('runner_events: append + list preserves order', () => {
  createRunnerSession({
    id: 'sess-1',
    agentKind: 'claude-sdk',
    runtimeKind: 'sdk',
    role: 'free',
  })
  appendRunnerEvent('sess-1', { type: 'state', state: 'working', ts: 1 })
  appendRunnerEvent('sess-1', { type: 'assistant_message', text: 'hi', ts: 2 })
  appendRunnerEvent('sess-1', { type: 'exited', code: 0, ts: 3 })

  const events = listRunnerEvents('sess-1')
  assert.equal(events.length, 3)
  assert.equal(events[0]?.event.type, 'state')
  assert.equal(events[1]?.event.type, 'assistant_message')
  assert.equal(events[2]?.event.type, 'exited')
})

test('runner_events: tail with limit returns most recent in chronological order', () => {
  createRunnerSession({
    id: 's',
    agentKind: 'claude-sdk',
    runtimeKind: 'sdk',
    role: 'free',
  })
  for (let i = 1; i <= 5; i++) {
    appendRunnerEvent('s', { type: 'assistant_message', text: `m${i}`, ts: i })
  }
  const tail = listRunnerEvents('s', { limit: 3 })
  assert.equal(tail.length, 3)
  assert.equal(tail[0]?.ts, 3)
  assert.equal(tail[2]?.ts, 5)
})

test('appendEventAndUpdateSession: atomic event + patch', () => {
  createRunnerSession({
    id: 'sess-1',
    agentKind: 'claude-sdk',
    runtimeKind: 'sdk',
    role: 'free',
  })
  appendEventAndUpdateSession(
    'sess-1',
    { type: 'state', state: 'working', ts: 1 },
    { state: 'working' },
  )
  assert.equal(getRunnerSession('sess-1')?.state, 'working')
  assert.equal(listRunnerEvents('sess-1').length, 1)
})

test('deleteRunnerSession: cascades runner_events', () => {
  createRunnerSession({
    id: 'gone',
    agentKind: 'claude-sdk',
    runtimeKind: 'sdk',
    role: 'free',
  })
  appendRunnerEvent('gone', { type: 'state', state: 'working', ts: 1 })
  appendRunnerEvent('gone', { type: 'exited', code: 0, ts: 2 })
  deleteRunnerSession('gone')
  assert.equal(getRunnerSession('gone'), undefined)
  assert.equal(listRunnerEvents('gone').length, 0)
})

test('runs cascade to node_runs and runner_sessions on feature delete', () => {
  const run = createRun({ featureId: 1, workflowId: 1, task: 't', agentKind: 'claude-sdk' })
  const nr = createNodeRun({ runId: run.id, nodeId: 'n1', title: 'N1' })
  createRunnerSession({
    id: 's-cascade',
    agentKind: 'claude-sdk',
    runtimeKind: 'sdk',
    role: 'free',
    runId: run.id,
    nodeRunId: nr.id,
  })
  getDb().prepare('DELETE FROM features WHERE id = ?').run(1)
  assert.equal(getRun(run.id), undefined)
  assert.equal(getNodeRun(nr.id), undefined)
  assert.equal(getRunnerSession('s-cascade'), undefined)
})
