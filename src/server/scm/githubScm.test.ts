import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GitHubScmAdapter } from './githubScm.js'

let tmp: string
let stubScript: string

function adapter(): GitHubScmAdapter {
  // Invoke the stub via Node so execFile works identically on Win / mac /
  // Linux without needing a .cmd / .sh launcher.
  return new GitHubScmAdapter({
    ghBinary: process.execPath,
    ghLeadArgs: [stubScript],
  })
}

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ay-scm-'))
  // Tiny Node script that echoes a routing-based reply per `gh` subcommand.
  // We point the adapter at this stub via the ghLeadArgs option so the
  // test never touches the real `gh` CLI / network.
  stubScript = path.join(tmp, 'gh-stub.mjs')
  writeFileSync(
    stubScript,
    `#!/usr/bin/env node
const args = process.argv.slice(2)
const join = args.join(' ')

if (args[0] === '--version') { console.log('gh version 2.99.0'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'status') { console.log('logged in'); process.exit(0) }

if (args[0] === 'pr' && args[1] === 'create') {
  console.log('Creating pull request')
  console.log('https://github.com/foo/bar/pull/42')
  process.exit(0)
}

if (args[0] === 'pr' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    headRefOid: 'deadbeef',
    reviewDecision: 'APPROVED',
    reviews: [{ author: { login: 'octocat' } }],
  }))
  process.exit(0)
}

if (args[0] === 'api' && args[1].startsWith('repos/') && args[1].includes('/check-runs')) {
  process.stdout.write(JSON.stringify({
    runs: [
      { name: 'build', status: 'completed', conclusion: 'success' },
      { name: 'test',  status: 'completed', conclusion: 'success' },
    ],
  }))
  process.exit(0)
}

if (args[0] === 'api' && args[1].includes('/pulls/') && args[1].endsWith('/comments')) {
  process.stdout.write(JSON.stringify([
    { id: 7, user: { login: 'rev1' }, body: 'nit', path: 'src/x.ts', line: 12, created_at: '2026-06-14T10:00:00Z' },
  ]))
  process.exit(0)
}

console.error('unexpected gh args: ' + join)
process.exit(2)
`,
    'utf8',
  )
  // No launcher script — `adapter()` invokes the stub via `process.execPath`
  // directly so this works identically on Windows / mac / Linux.
})

after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

test('probe: returns ok when gh + auth succeed', async () => {
  const scm = adapter()
  const result = await scm.probe()
  assert.equal(result.ok, true)
})

test('createPr: extracts the number from gh URL output', async () => {
  const scm = adapter()
  const out = await scm.createPr({
    repo: 'foo/bar',
    branch: 'feat',
    base: 'main',
    title: 't',
    body: 'b',
  })
  assert.equal(out.number, 42)
  assert.match(out.url, /github\.com\/foo\/bar\/pull\/42/)
})

test('getPr: maps gh fields to PrStatus', async () => {
  const scm = adapter()
  const status = await scm.getPr({ repo: 'foo/bar', number: 42 })
  assert.equal(status.state, 'open')
  assert.equal(status.headSha, 'deadbeef')
  assert.equal(status.mergeable, true)
  assert.equal(status.approved, true)
  assert.deepEqual(status.reviewers, ['octocat'])
})

test('pollChecks: aggregates done + allGreen from check-runs JSON', async () => {
  const scm = adapter()
  const checks = await scm.pollChecks({ repo: 'foo/bar', ref: 'deadbeef' })
  assert.equal(checks.done, true)
  assert.equal(checks.allGreen, true)
  assert.equal(checks.runs.length, 2)
})

test('listReviewComments: maps gh fields to ReviewComment[]', async () => {
  const scm = adapter()
  const comments = await scm.listReviewComments({ repo: 'foo/bar', number: 42 })
  assert.equal(comments.length, 1)
  assert.equal(comments[0]?.author, 'rev1')
  assert.equal(comments[0]?.body, 'nit')
})

test('isMergeable: true when status is mergeable + approved + open', async () => {
  const scm = adapter()
  assert.equal(await scm.isMergeable({ repo: 'foo/bar', number: 42 }), true)
})
