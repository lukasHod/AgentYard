import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setDbPathForTesting, closeDb, getDb } from '../db.js'
import { ensureDefaultWorkflow } from '../workflows.js'

let tmp: string

/** Insert a planet row directly — bypasses git-repo validation. */
function insertPlanet(name: string): number {
  const db = getDb()
  const info = db
    .prepare(
      "INSERT INTO planets (name, project_path, state, created_at, texture, has_clouds) VALUES (?, ?, 'idle', ?, 'earth', 0)",
    )
    .run(name, os.tmpdir(), Date.now())
  return Number(info.lastInsertRowid)
}

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ay-features-route-'))
  setDbPathForTesting(path.join(tmp, 'test.db'))
  ensureDefaultWorkflow()
})

after(() => {
  closeDb()
  rmSync(tmp, { recursive: true, force: true })
})

test('createFeature stores name and task', async () => {
  const { createFeature, getFeature } = await import('../features.js')
  const planetId = insertPlanet('test-planet')
  const feature = createFeature({ planetId, name: 'my-feature', task: 'build the thing', workflowId: 0 })
  assert.equal(feature.name, 'my-feature')
  assert.equal(feature.task, 'build the thing')
  const loaded = getFeature(feature.id)
  assert.ok(loaded)
  assert.equal(loaded.task, 'build the thing')
})

test('POST /api/planets/:id/features returns feature with id at top level', async () => {
  const { default: Fastify } = await import('fastify')
  const { registerFeatureRoutes } = await import('./features.js')

  const planetId = insertPlanet('planet-b')

  const app = Fastify({ logger: false })
  const mockIo = { emit: () => {} } as any
  registerFeatureRoutes({
    app,
    io: mockIo,
    manager: {} as any,
    terminals: {} as any,
    testRuns: {} as any,
    runState: {} as any,
    transcripts: {} as any,
    pendingQuestions: {} as any,
    planetChats: {} as any,
    apiError: (reply: any, code: number, msg: string) => reply.code(code).send({ error: msg }),
  } as any)

  await app.ready()

  const res = await app.inject({
    method: 'POST',
    url: `/api/planets/${planetId}/features`,
    payload: { name: 'alpha', task: 'implement alpha' },
  })

  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.ok(typeof body.id === 'number', `expected body.id to be a number, got ${JSON.stringify(body)}`)
  assert.equal(body.name, 'alpha')
  assert.equal(body.task, 'implement alpha')
})

test('POST without body uses timestamp name and empty task', async () => {
  const { default: Fastify } = await import('fastify')
  const { registerFeatureRoutes } = await import('./features.js')

  const planetId = insertPlanet('planet-c')
  const app = Fastify({ logger: false })
  registerFeatureRoutes({
    app,
    io: { emit: () => {} } as any,
    manager: {} as any,
    terminals: {} as any,
    testRuns: {} as any,
    runState: {} as any,
    transcripts: {} as any,
    pendingQuestions: {} as any,
    planetChats: {} as any,
    apiError: (reply: any, code: number, msg: string) => reply.code(code).send({ error: msg }),
  } as any)
  await app.ready()

  const res = await app.inject({ method: 'POST', url: `/api/planets/${planetId}/features` })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.ok(typeof body.id === 'number')
  assert.ok(body.name.startsWith('feature-'), `name should be timestamped, got: ${body.name}`)
  assert.equal(body.task, '')
})
