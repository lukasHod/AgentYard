import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeDb, getDb, setDbPathForTesting } from './db.js'
import { getPlanetSetting, getPlanetSettings, setPlanetSetting } from './planetSettings.js'
import { deletePlanet } from './planets.js'

let tmp: string

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ay-planet-settings-'))
  setDbPathForTesting(path.join(tmp, 'agentyard.db'))
})

after(() => {
  setDbPathForTesting(null)
  closeDb()
  rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
  const db = getDb()
  db.exec(`DELETE FROM planet_settings; DELETE FROM planets;`)
  db.prepare(
    `INSERT INTO planets (id, name, project_path, state, created_at, texture, has_clouds)
     VALUES (1, 'p', '/tmp/p', 'idle', ?, 'Alpine', 0)`,
  ).run(Date.now())
})

test('planetSettings: set/get/overwrite/clear round-trip', () => {
  assert.equal(getPlanetSetting(1, 'claude-cli-args'), null)

  setPlanetSetting(1, 'claude-cli-args', '--dangerously-skip-permissions')
  assert.equal(getPlanetSetting(1, 'claude-cli-args'), '--dangerously-skip-permissions')

  setPlanetSetting(1, 'claude-cli-args', '--model opus')
  assert.equal(getPlanetSetting(1, 'claude-cli-args'), '--model opus')

  setPlanetSetting(1, 'claude-cli-args', null)
  assert.equal(getPlanetSetting(1, 'claude-cli-args'), null)
})

test('planetSettings: getPlanetSettings returns all keys for a planet', () => {
  setPlanetSetting(1, 'default-terminal-type', 'claude-cli')
  setPlanetSetting(1, 'claude-cli-args', '--dangerously-skip-permissions')
  assert.deepEqual(getPlanetSettings(1), {
    'default-terminal-type': 'claude-cli',
    'claude-cli-args': '--dangerously-skip-permissions',
  })
})

test('planetSettings: deleting a planet cascades into planet_settings', () => {
  setPlanetSetting(1, 'claude-cli-args', '--dangerously-skip-permissions')
  deletePlanet(1)
  assert.deepEqual(getPlanetSettings(1), {})
})
