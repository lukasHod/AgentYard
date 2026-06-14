import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnPty } from './ptyRuntime.js'

test('spawnPty: child runs, data flows, exit emits with code', async () => {
  const proc = spawnPty({
    argv: [process.execPath, '-e', 'process.stdout.write("hello\\n"); process.exit(0);'],
  })
  let stdout = ''
  proc.events.on('data', (d: string) => {
    stdout += d
  })
  const exitInfo = await new Promise<{ code: number | null; signal: number | null }>((resolve) => {
    proc.events.once('exit', resolve)
  })
  assert.equal(exitInfo.code, 0)
  assert.ok(stdout.includes('hello'), `expected stdout to include 'hello', got: ${JSON.stringify(stdout)}`)
})

test('spawnPty: kill() terminates a long-running process', async () => {
  const proc = spawnPty({
    argv: [process.execPath, '-e', 'setInterval(() => {}, 1000);'],
  })
  const exitPromise = new Promise<{ code: number | null }>((resolve) => {
    proc.events.once('exit', resolve)
  })
  await proc.kill()
  // Wait for exit (kill awaits internally up to grace) or assert it already fired.
  const info = await Promise.race([
    exitPromise,
    new Promise<{ code: number | null }>((resolve) => setTimeout(() => resolve({ code: 999 }), 7000)),
  ])
  assert.notEqual(info.code, 999, 'process should have exited before the 7s test timeout')
})

test('spawnPty: rolling buffer accumulates data', async () => {
  const proc = spawnPty({
    argv: [process.execPath, '-e', 'process.stdout.write("abc"); process.exit(0);'],
  })
  await new Promise<void>((resolve) => proc.events.once('exit', () => resolve()))
  // Buffer may include terminal control sequences; what matters is that
  // the literal payload landed.
  assert.ok(proc.buffer().includes('abc'), `buffer missing payload: ${JSON.stringify(proc.buffer())}`)
})
