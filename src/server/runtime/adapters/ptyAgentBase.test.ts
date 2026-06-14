import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentEvent, AgentRuntimeContext, AgentStartConfig } from '../../../core/plugins.js'
import { PtyAgentBase, type PtyLaunchPlan, stripAnsi } from './ptyAgentBase.js'

const noopCtx: AgentRuntimeContext = {
  recordEvent: () => {},
  log: { info: () => {}, warn: () => {}, error: () => {} },
}

class EchoAdapter extends PtyAgentBase {
  constructor() {
    super({
      kind: 'claude-code-cli',
      capabilities: {
        supports_tools: false,
        supports_structured_events: false,
        supports_clarification_tool: false,
        supports_resume: false,
        supports_cost: false,
        supports_mcp: false,
        supports_working_directory: true,
      },
    })
  }
  protected plan(_cfg: AgentStartConfig): PtyLaunchPlan {
    return {
      argv: [
        process.execPath,
        '-e',
        // Print three lines so we can verify the line classifier sees them.
        'console.log("line-1"); console.log("line-2"); console.log("line-3"); process.exit(0);',
      ],
    }
  }
  protected classify(line: string): AgentEvent | null {
    return { type: 'assistant_message', text: line, ts: Date.now() }
  }
}

async function collectUntilExit(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const ev of events) {
    out.push(ev)
    if (ev.type === 'exited') break
  }
  return out
}

test('PtyAgentBase: classifies each non-empty line and emits exited', async () => {
  const adapter = new EchoAdapter()
  const handle = await adapter.start({ role: 'free' }, noopCtx)
  const events = await collectUntilExit(handle.events)

  const messages = events
    .filter((e): e is Extract<AgentEvent, { type: 'assistant_message' }> => e.type === 'assistant_message')
    .map((e) => e.text)
  assert.deepEqual(
    messages.filter((m) => m.startsWith('line-')),
    ['line-1', 'line-2', 'line-3'],
  )

  const exit = events.find((e) => e.type === 'exited')
  assert.ok(exit, 'should emit exited event')
  if (exit?.type === 'exited') assert.equal(exit.code, 0)
})

test('PtyAgentBase: state events sandwich the run', async () => {
  const adapter = new EchoAdapter()
  const handle = await adapter.start({ role: 'free' }, noopCtx)
  const events = await collectUntilExit(handle.events)

  const states = events
    .filter((e): e is Extract<AgentEvent, { type: 'state' }> => e.type === 'state')
    .map((e) => e.state)
  assert.ok(states.includes('working'), `expected a 'working' state; got ${states.join(',')}`)
})

test('stripAnsi: removes CSI and OSC sequences', () => {
  const sample = '\x1b[31mred\x1b[0m and \x1b]0;title\x07trailing'
  assert.equal(stripAnsi(sample), 'red and trailing')
})

test('stripAnsi: handles cursor and clear-screen sequences', () => {
  const sample = '\x1b[2J\x1b[H\x1b[?25hhello\x1b[?25l'
  assert.equal(stripAnsi(sample), 'hello')
})
