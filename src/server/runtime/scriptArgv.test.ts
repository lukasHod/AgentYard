import test from 'node:test'
import assert from 'node:assert/strict'
import { buildScriptArgv, runProcess } from './scriptArgv.js'
import type { ScriptTool } from '../../core/tools.js'

function makeScript(cmd: string, argNames: string[] = []): ScriptTool {
  return {
    name: 'test-script',
    description: '',
    cmd,
    args: argNames.map((name) => ({ name, required: false })),
  }
}

test('buildScriptArgv tokenizes by whitespace; first token is program', () => {
  const r = buildScriptArgv(makeScript('echo hello'), {})
  assert.deepEqual(r, { program: 'echo', args: ['hello'] })
})

test('buildScriptArgv substitutes {arg} per token', () => {
  const r = buildScriptArgv(makeScript('echo {msg}', ['msg']), { msg: 'hi' })
  assert.deepEqual(r, { program: 'echo', args: ['hi'] })
})

test('substituted value with spaces stays one argv slot', () => {
  const r = buildScriptArgv(makeScript('echo {msg}', ['msg']), { msg: 'hello world' })
  assert.deepEqual(r, { program: 'echo', args: ['hello world'] })
})

test('substituted value with shell metacharacters stays one argv slot', () => {
  const r = buildScriptArgv(makeScript('echo {msg}', ['msg']), {
    msg: '; rm -rf / && evil $(whoami) `id` | nc x.y',
  })
  assert.deepEqual(r, {
    program: 'echo',
    args: ['; rm -rf / && evil $(whoami) `id` | nc x.y'],
  })
})

test('empty cmd throws', () => {
  assert.throws(() => buildScriptArgv(makeScript(''), {}))
  assert.throws(() => buildScriptArgv(makeScript('   '), {}))
})

test('multiple tokens preserved across substitution', () => {
  const r = buildScriptArgv(
    makeScript('node -e console.log(process.argv[1]) {x}', ['x']),
    { x: 'foo' },
  )
  assert.deepEqual(r, {
    program: 'node',
    args: ['-e', 'console.log(process.argv[1])', 'foo'],
  })
})

test('missing arg value substitutes empty string (does NOT remove the slot)', () => {
  // The token is exactly {x}; with x missing, it becomes ''. The slot remains.
  const r = buildScriptArgv(makeScript('echo {x}', ['x']), {})
  assert.deepEqual(r, { program: 'echo', args: [''] })
})

// ── Integration: shell-metacharacter values can't escape via spawn ──

test('runProcess: shell metacharacters in arg value are literal text', async () => {
  // If a shell were involved, "; echo PWNED" would run as a separate command.
  // With shell:false, it's a literal argv[1] passed to node -e ...
  const r = await runProcess(
    process.execPath,
    ['-e', 'console.log(process.argv[1])', '; echo PWNED'],
    { timeoutMs: 10_000 },
  )
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}. stderr:\n${r.stderr}`)
  assert.equal(r.stdout.trim(), '; echo PWNED')
  assert.equal(r.stderr, '')
})

test('runProcess: backtick / $() in value are literal', async () => {
  const r = await runProcess(
    process.execPath,
    ['-e', 'console.log(process.argv[1])', '`whoami` $(id)'],
    { timeoutMs: 10_000 },
  )
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '`whoami` $(id)')
})

test('runProcess: nonzero exit surfaces in result.code (no throw)', async () => {
  const r = await runProcess(process.execPath, ['-e', 'process.exit(7)'], {
    timeoutMs: 10_000,
  })
  assert.equal(r.code, 7)
})

test('runProcess: timeout kills child and surfaces in stderr', async () => {
  const r = await runProcess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { timeoutMs: 200 },
  )
  assert.equal(r.timedOut, true)
  assert.match(r.stderr, /timeout/)
})

test('runProcess: abort signal kills child and surfaces in stderr', async () => {
  const ctl = new AbortController()
  setTimeout(() => ctl.abort(), 50)
  const r = await runProcess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { timeoutMs: 10_000, signal: ctl.signal },
  )
  assert.match(r.stderr, /aborted/)
  // exit code can be 130 (our sentinel) or whatever the OS uses for SIGKILL
  assert.notEqual(r.code, 0)
})

test('runProcess: already-aborted signal returns immediately', async () => {
  const ctl = new AbortController()
  ctl.abort()
  const r = await runProcess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { timeoutMs: 10_000, signal: ctl.signal },
  )
  assert.match(r.stderr, /aborted/)
})

test('runProcess: output cap kills child before unbounded buffering', async () => {
  // Write more than the cap; runProcess should slice output and kill.
  const r = await runProcess(
    process.execPath,
    ['-e', 'for (let i = 0; i < 10000; i++) process.stdout.write("xxxxxxxxxx\\n")'],
    { timeoutMs: 10_000, maxOutputChars: 200 },
  )
  assert.ok(r.stdout.length <= 200, `stdout was ${r.stdout.length} chars`)
  assert.match(r.stderr, /exceeded/)
})
