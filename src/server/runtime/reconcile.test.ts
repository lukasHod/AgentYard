import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeDb, getDb, setDbPathForTesting } from '../db.js'
import {
  createRun,
  createRunnerSession,
  getRun,
  getRunnerSession,
  listRunnerEvents,
} from '../runStore.js'
import { reconcileStaleSessions } from './reconcile.js'

const fakeLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  trace: () => {},
  debug: () => {},
  silent: () => {},
  level: 'info',
  child: () => fakeLog,
} as unknown as Parameters<typeof reconcileStaleSessions>[0]

let tmp: string

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ay-reconcile-'))
  setDbPathForTesting(path.join(tmp, 'agentyard.db'))
})

after(() => {
  setDbPathForTesting(null)
  closeDb()
  rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
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

test('reconcileStaleSessions: terminates sdk sessions and marks runs stuck', () => {
  const run = createRun({ featureId: 1, workflowId: 1, task: 't', agentKind: 'claude-sdk' })
  createRunnerSession({
    id: 'live-sdk',
    agentKind: 'claude-sdk',
    runtimeKind: 'sdk',
    role: 'leader',
    runId: run.id,
  })
  // Free-chat session has no parent run — it should be terminated but
  // shouldn't add to the affected runs set.
  createRunnerSession({
    id: 'orphan-sdk',
    agentKind: 'claude-sdk',
    runtimeKind: 'sdk',
    role: 'free',
  })

  reconcileStaleSessions(fakeLog)

  assert.equal(getRunnerSession('live-sdk')?.state, 'terminated')
  assert.equal(getRunnerSession('live-sdk')?.reason, 'runtime_lost')
  assert.equal(getRunnerSession('orphan-sdk')?.state, 'terminated')
  assert.equal(getRun(run.id)?.state, 'stuck')

  const events = listRunnerEvents('live-sdk')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.event.type, 'exited')
})

test('reconcileStaleSessions: leaves already-terminal rows alone', () => {
  createRunnerSession({
    id: 'gone',
    agentKind: 'claude-sdk',
    runtimeKind: 'sdk',
    role: 'free',
  })
  getDb()
    .prepare("UPDATE runner_sessions SET state = 'done' WHERE id = ?")
    .run('gone')

  reconcileStaleSessions(fakeLog)

  // No new event because the row wasn't in a non-terminal state.
  assert.equal(listRunnerEvents('gone').length, 0)
  assert.equal(getRunnerSession('gone')?.state, 'done')
})

test('reconcileStaleSessions: pty sessions logged but not auto-terminated', () => {
  // PTY probe path lands with Phase 2; reconcile should not silently kill
  // a PTY session whose process is actually alive.
  const calls: string[] = []
  const ptyLog = {
    ...fakeLog,
    warn: (msg: string) => calls.push(msg),
  } as unknown as Parameters<typeof reconcileStaleSessions>[0]

  createRunnerSession({
    id: 'pty-1',
    agentKind: 'claude-code-cli',
    runtimeKind: 'pty',
    role: 'free',
    pid: 12345,
  })

  reconcileStaleSessions(ptyLog)

  assert.equal(getRunnerSession('pty-1')?.state, 'not_started')
  assert.equal(calls.length, 1)
  assert.ok(calls[0]?.includes('pty-1'))
})
