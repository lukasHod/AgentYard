import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeDb, getDb, setDbPathForTesting } from '../db.js'
import { listTerminalChunks } from '../terminalStore.js'
import { TerminalSessionManager } from './TerminalSessionManager.js'
import type { PtyProcess, PtySpawnOptions } from './runtimes/ptyRuntime.js'

type PtySpawner = (opts: PtySpawnOptions) => PtyProcess

let tmp: string

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ay-term-'))
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
    DELETE FROM terminal_transcript_chunks;
    DELETE FROM terminal_sessions;
    DELETE FROM features;
    DELETE FROM planets;
  `)
  db.prepare(
    `INSERT INTO planets (id, name, project_path, state, created_at, texture, has_clouds)
     VALUES (1, 'p', '/tmp/p', 'idle', ?, 'Alpine', 0)`,
  ).run(Date.now())
  db.prepare(
    `INSERT INTO features (id, planet_id, name, task, status, workflow_id, created_at)
     VALUES (42, 1, 'f', 'task', 'idle', 1, ?)`,
  ).run(Date.now())
})

function waitForExit(manager: TerminalSessionManager, sessionId: string): Promise<{ code: number | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.off('terminal:event', onEvent)
      reject(new Error(`timed out waiting for ${sessionId} exit`))
    }, 10000)
    const onEvent = (ev: unknown) => {
      const event = ev as { type?: string; sessionId?: string; code?: number | null }
      if (event.type !== 'exit' || event.sessionId !== sessionId) return
      clearTimeout(timer)
      manager.off('terminal:event', onEvent)
      resolve({ code: event.code ?? null })
    }
    manager.on('terminal:event', onEvent)
  })
}

function createFakeSpawner(outputFor: (opts: PtySpawnOptions) => string = () => ''): PtySpawner {
  return (opts) => {
    const events = new EventEmitter()
    let rolling = ''
    let exited = false
    const proc: PtyProcess = {
      pid: 1234,
      buffer: () => rolling,
      write: (text) => {
        rolling += text
        events.emit('data', text)
      },
      resize: () => {},
      kill: async () => {
        if (exited) return
        exited = true
        events.emit('exit', { code: null, signal: null })
      },
      events,
    }
    setTimeout(() => {
      if (exited) return
      const data = outputFor(opts)
      rolling += data
      if (data) events.emit('data', data)
      exited = true
      events.emit('exit', { code: 0, signal: null })
    }, 0)
    return proc
  }
}

test('TerminalSessionManager: starts a custom PTY and persists output chunks', async () => {
  const manager = new TerminalSessionManager({
    spawn: createFakeSpawner(() => 'terminal-ok\n'),
    reconcileStaleSessions: false,
  })
  const exitPromise = waitForExit(manager, 'term-test')
  const session = manager.start({
    sessionId: 'term-test',
    profileId: 'custom',
    argv: [process.execPath, '-e', 'process.stdout.write("terminal-ok\\n"); process.exit(0);'],
  })

  assert.equal(session.id, 'term-test')
  assert.equal(session.state, 'running')

  const exit = await exitPromise
  assert.equal(exit.code, 0)

  const snapshot = manager.snapshot('term-test')
  assert.ok(snapshot)
  assert.equal(snapshot.state, 'exited')
  assert.ok(snapshot.data.includes('terminal-ok'), JSON.stringify(snapshot.data))
  assert.ok(listTerminalChunks('term-test').join('').includes('terminal-ok'))
})

test('TerminalSessionManager: injects AgentYard context env', async () => {
  const manager = new TerminalSessionManager({
    spawn: createFakeSpawner((opts) => {
      const env = opts.env ?? {}
      return `${env.AGENTYARD_SESSION_ID}:${env.AGENTYARD_FEATURE_ID}\n`
    }),
    reconcileStaleSessions: false,
  })
  const exitPromise = waitForExit(manager, 'term-env')
  manager.start({
    sessionId: 'term-env',
    profileId: 'custom',
    featureId: 42,
    argv: [
      process.execPath,
      '-e',
      'process.stdout.write(`${process.env.AGENTYARD_SESSION_ID}:${process.env.AGENTYARD_FEATURE_ID}\\n`);',
    ],
  })

  await exitPromise

  const snapshot = manager.snapshot('term-env')
  assert.ok(snapshot?.data.includes('term-env:42'), JSON.stringify(snapshot?.data))
})

test('TerminalSessionManager: kill marks a live session as killed', async () => {
  const manager = new TerminalSessionManager({
    spawn: createFakeSpawner(() => ''),
    reconcileStaleSessions: false,
  })
  manager.start({
    sessionId: 'term-kill',
    profileId: 'custom',
    argv: [process.execPath, '-e', 'setInterval(() => {}, 1000);'],
  })

  const killed = await manager.kill('term-kill')
  assert.equal(killed, true)
  assert.equal(manager.get('term-kill')?.state, 'killed')
})

test('TerminalSessionManager: restart keeps the same session id', async () => {
  let starts = 0
  const manager = new TerminalSessionManager({
    spawn: createFakeSpawner(() => `run-${++starts}\n`),
    reconcileStaleSessions: false,
  })
  let exitPromise = waitForExit(manager, 'term-restart')
  manager.start({
    sessionId: 'term-restart',
    profileId: 'custom',
    argv: [process.execPath, '-e', 'process.stdout.write("first\\n"); process.exit(0);'],
  })

  await exitPromise
  assert.equal(manager.get('term-restart')?.state, 'exited')

  exitPromise = waitForExit(manager, 'term-restart')
  const restarted = manager.restart('term-restart')
  assert.equal(restarted?.id, 'term-restart')
  assert.equal(restarted?.state, 'running')

  await exitPromise
  const snapshot = manager.snapshot('term-restart')
  assert.ok(snapshot?.data.includes('run-1'), JSON.stringify(snapshot?.data))
  assert.ok(snapshot?.data.includes('run-2'), JSON.stringify(snapshot?.data))
  assert.equal(manager.list().filter((s) => s.id === 'term-restart').length, 1)
})
