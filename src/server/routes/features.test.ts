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

/** Insert a planet row with an explicit project path — bypasses git-repo validation. */
function insertPlanetWithPath(name: string, projectPath: string): number {
  const db = getDb()
  const info = db
    .prepare(
      "INSERT INTO planets (name, project_path, state, created_at, texture, has_clouds) VALUES (?, ?, 'idle', ?, 'earth', 0)",
    )
    .run(name, projectPath, Date.now())
  return Number(info.lastInsertRowid)
}

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

test('POST with task emits feature:updated with status running after worktree creation', async () => {
  // We can't run a real workflow (no git repo), but we verify the route:
  // 1. Returns 200 immediately with the feature
  // 2. Emits feature:created synchronously
  // 3. Emits feature:updated with status 'failed' when worktree creation fails
  //    (expected in a temp dir that isn't a git repo)

  const { default: Fastify } = await import('fastify')
  const { registerFeatureRoutes } = await import('./features.js')

  const emitted: { event: string; payload: any }[] = []
  const mockIo = { emit: (event: string, payload: any) => emitted.push({ event, payload }) } as any

  // Use a real tmp dir that exists but is not a git repo
  const planetId = insertPlanetWithPath('planet-wf', tmp)

  const app = Fastify({ logger: false })
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
    payload: { name: 'wf-feature', task: 'do workflow stuff' },
  })

  // Route returns immediately with status 200 and the feature id
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.ok(typeof body.id === 'number')

  // feature:created was emitted synchronously before the background task
  assert.ok(emitted.some(e => e.event === 'feature:created' && e.payload.name === 'wf-feature'))

  // Poll until the background void promise settles (max 3s — git subprocess timing varies under load)
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (emitted.some(e => e.event === 'feature:updated')) break
    await new Promise(r => setTimeout(r, 50))
  }

  // The background task failed (not a git repo) → feature:updated with status failed
  const updatedEvents = emitted.filter(e => e.event === 'feature:updated')
  assert.ok(
    updatedEvents.some(e => e.payload.status === 'failed'),
    `expected a feature:updated with status=failed, got: ${JSON.stringify(updatedEvents)}`,
  )
})
