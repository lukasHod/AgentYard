import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadSecrets, resolveEnvVars, isSecretEnvName } from './secrets.js'

describe('resolveEnvVars secret blocking', () => {
  before(() => {
    process.env.AY_TEST_PLAIN = 'plain-value'
    process.env.AY_TEST_API_KEY = 'sk-should-not-leak'
    process.env.AY_TEST_GH_TOKEN = 'ghp_should_not_leak'
  })
  after(() => {
    delete process.env.AY_TEST_PLAIN
    delete process.env.AY_TEST_API_KEY
    delete process.env.AY_TEST_GH_TOKEN
  })

  it('substitutes non-secret vars', () => {
    assert.equal(resolveEnvVars('x=${env:AY_TEST_PLAIN}'), 'x=plain-value')
  })

  it('blocks vars whose name looks like a credential', () => {
    assert.equal(resolveEnvVars('${env:AY_TEST_API_KEY}'), '')
    assert.equal(resolveEnvVars('${env:AY_TEST_GH_TOKEN}'), '')
  })

  it('allowSecrets bypasses the block for trusted call sites', () => {
    assert.equal(
      resolveEnvVars('${env:AY_TEST_API_KEY}', { allowSecrets: true }),
      'sk-should-not-leak',
    )
  })

  it('strict mode throws rather than silently emptying a secret', () => {
    assert.throws(() => resolveEnvVars('${env:AY_TEST_API_KEY}', { strict: true }))
  })

  it('isSecretEnvName matches common credential shapes', () => {
    assert.ok(isSecretEnvName('ANTHROPIC_API_KEY'))
    assert.ok(isSecretEnvName('AWS_SECRET_ACCESS_KEY'))
    assert.ok(isSecretEnvName('GITHUB_TOKEN'))
    assert.ok(!isSecretEnvName('AY_TEST_PLAIN'))
  })
})

describe('loadSecrets marks file keys as secret', () => {
  let home: string
  const prevHome = process.env.AGENTYARD_HOME

  before(() => {
    home = mkdtempSync(path.join(tmpdir(), 'ay-secrets-'))
    process.env.AGENTYARD_HOME = home
    const secretsDir = path.join(home, '.secrets')
    mkdirSync(secretsDir, { recursive: true })
    // A deliberately innocuous-named key so only the file membership marks it secret.
    writeFileSync(path.join(secretsDir, 'secrets.env'), 'MY_DEPLOY_HANDLE=hunter2\n', 'utf8')
    loadSecrets()
  })
  after(() => {
    if (prevHome === undefined) delete process.env.AGENTYARD_HOME
    else process.env.AGENTYARD_HOME = prevHome
    delete process.env.MY_DEPLOY_HANDLE
    rmSync(home, { recursive: true, force: true })
  })

  it('blocks substitution of a var that came from the secrets file', () => {
    assert.equal(process.env.MY_DEPLOY_HANDLE, 'hunter2')
    assert.ok(isSecretEnvName('MY_DEPLOY_HANDLE'))
    assert.equal(resolveEnvVars('${env:MY_DEPLOY_HANDLE}'), '')
  })
})
