import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ClaudeCodeCliAdapter } from './claudeCodeCli.js'
import { CodexCliAdapter } from './codexCli.js'
import { AgentAdapterRegistry } from './registry.js'

test('AgentAdapterRegistry: ships the three Phase 5 adapters', () => {
  const reg = new AgentAdapterRegistry()
  const kinds = reg.list().map((a) => a.kind)
  assert.deepEqual(kinds.sort(), ['claude-code-cli', 'claude-sdk', 'codex-cli'])
})

test('AgentAdapterRegistry: get throws on unknown kind', () => {
  const reg = new AgentAdapterRegistry()
  // @ts-expect-error — intentionally bad kind to test the runtime guard
  assert.throws(() => reg.get('aider'))
})

test('ClaudeCodeCliAdapter: plan builds the expected argv', () => {
  const adapter = new ClaudeCodeCliAdapter()
  // Reach into the protected `plan` via a dummy subclass to verify shape.
  class Probe extends ClaudeCodeCliAdapter {
    callPlan(cfg: Parameters<ClaudeCodeCliAdapter['start']>[0]) {
      return (this as unknown as { plan: (cfg: unknown) => { argv: string[] } }).plan(cfg)
    }
  }
  void adapter
  const probe = new Probe()
  const plan = probe.callPlan({
    role: 'free',
    cwd: '/tmp',
    systemPrompt: 'You are blue.',
    model: 'claude-opus-4-7',
    extras: { skipPermissions: true, binaryPath: 'C:\\bin\\claude.cmd' },
  })
  assert.equal(plan.argv[0], 'C:\\bin\\claude.cmd')
  assert.ok(plan.argv.includes('--dangerously-skip-permissions'))
  assert.ok(plan.argv.includes('--model'))
  assert.ok(plan.argv.includes('claude-opus-4-7'))
  assert.ok(plan.argv.includes('--append-system-prompt'))
  assert.ok(plan.argv.includes('You are blue.'))
})

test('CodexCliAdapter: plan adds --no-update-check by default', () => {
  class Probe extends CodexCliAdapter {
    callPlan(cfg: Parameters<CodexCliAdapter['start']>[0]) {
      return (this as unknown as { plan: (cfg: unknown) => { argv: string[] } }).plan(cfg)
    }
  }
  const plan = new Probe().callPlan({ role: 'free', systemPrompt: 'be terse' })
  assert.equal(plan.argv[0], 'codex')
  assert.ok(plan.argv.includes('--no-update-check'))
  assert.ok(plan.argv.includes('-c'))
  assert.ok(plan.argv.some((a) => a.startsWith('developer_instructions=')))
})

test('CodexCliAdapter: noUpdateCheck=false omits the flag', () => {
  class Probe extends CodexCliAdapter {
    callPlan(cfg: Parameters<CodexCliAdapter['start']>[0]) {
      return (this as unknown as { plan: (cfg: unknown) => { argv: string[] } }).plan(cfg)
    }
  }
  const plan = new Probe().callPlan({
    role: 'free',
    extras: { noUpdateCheck: false },
  })
  assert.ok(!plan.argv.includes('--no-update-check'))
})

test('Adapters expose capabilities consistently', () => {
  const reg = new AgentAdapterRegistry()
  for (const adapter of reg.list()) {
    assert.equal(typeof adapter.capabilities.supports_tools, 'boolean')
    assert.equal(typeof adapter.capabilities.supports_working_directory, 'boolean')
  }
})
