/**
 * Static smoke — verifies the SDK options Session would pass to query()
 * for various agent configurations. No real API calls.
 *
 * Asserts that:
 *  1. The system prompt is wired into agents.agentyard-agent.prompt
 *  2. When toolPreset === 'claude_code', the parent thread gets the full
 *     Claude Code preset (tools: { type: 'preset', preset: 'claude_code' })
 *  3. When allowedTools is set, the agent's catalog is the UNION of those
 *     tools and the runtime MCP tool names (so drones still have
 *     request_clarification / scripts / etc.)
 *  4. When allowedTools is undefined (no narrowing), the agent definition
 *     omits `tools` so the agent inherits the full parent set
 *  5. When toolPreset is not 'claude_code', the parent thread has no
 *     built-in tools (`tools: []`) — only the runtime MCPs are available
 *  6. permissionMode is 'bypassPermissions' (drones don't get permission
 *     prompts inside the sandbox/feature worktree)
 *  7. cwd flows through to the SDK options when set
 *
 * Run with: npx tsx scripts/smoke-agent-permissions.ts
 * (No server needed.)
 */
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { Session } from '../src/server/runtime/Session.js'

// Minimal-but-real MCP tool factory for the smoke. The SDK rejects plain
// `{ name }` objects when building its MCP server; it needs a proper handler
// and zod schema. We never invoke these — we just need the names to flow
// through Session.buildSdkOptions() into agent.tools.
const fakeTool = (name: string) =>
  tool(name, `fake ${name}`, { ping: z.string() }, async () => ({ content: [] }))

interface Check {
  name: string
  pass: boolean
  detail?: string
}

const results: Check[] = []

function assert(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail: pass ? undefined : detail })
}

function arrayContains(haystack: unknown, needle: string): boolean {
  return Array.isArray(haystack) && haystack.includes(needle)
}

const CLARIFICATION = 'mcp__ay_runtime__request_clarification'

// ── Case 1: drone using claude_code preset, narrowed via allowedTools ──
// Mirrors the "tester" seed agent: Read/Glob/Grep/Bash, no Write/Edit.
{
  const s = new Session({
    id: 'test-1',
    role: 'drone',
    systemPrompt: 'You are the TESTER agent.',
    toolPreset: 'claude_code',
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    cwd: '/tmp/sandbox',
  })
  const opts = s.buildSdkOptions()

  assert(
    'claude_code drone: tools is the claude_code preset',
    JSON.stringify(opts.tools) === JSON.stringify({ type: 'preset', preset: 'claude_code' }),
    `got ${JSON.stringify(opts.tools)}`,
  )
  assert(
    'claude_code drone: permissionMode = bypassPermissions',
    opts.permissionMode === 'bypassPermissions',
  )
  assert(
    'claude_code drone: cwd threaded through',
    opts.cwd === '/tmp/sandbox',
    `got ${opts.cwd}`,
  )

  const agentDef = opts.agents?.['agentyard-agent']
  assert(
    'claude_code drone: agent definition exists',
    Boolean(agentDef),
  )
  assert(
    'claude_code drone: system prompt wired into agent.prompt',
    agentDef?.prompt === 'You are the TESTER agent.',
    `got ${agentDef?.prompt}`,
  )
  assert(
    "claude_code drone: agent.tools includes user's narrowed list (Read)",
    arrayContains(agentDef?.tools, 'Read'),
  )
  assert(
    "claude_code drone: agent.tools includes user's narrowed list (Bash)",
    arrayContains(agentDef?.tools, 'Bash'),
  )
  assert(
    'claude_code drone: agent.tools EXCLUDES forbidden built-ins (Write)',
    !arrayContains(agentDef?.tools, 'Write'),
  )
  assert(
    'claude_code drone: agent.tools EXCLUDES forbidden built-ins (Edit)',
    !arrayContains(agentDef?.tools, 'Edit'),
  )
  // The bug we just fixed — request_clarification must still be in the catalog.
  assert(
    'claude_code drone: agent.tools INCLUDES request_clarification (bug fix)',
    arrayContains(agentDef?.tools, CLARIFICATION),
    `agent.tools=${JSON.stringify(agentDef?.tools)}`,
  )
}

// ── Case 2: claude_code drone with no allowedTools → inherits full preset ──
{
  const s = new Session({
    id: 'test-2',
    role: 'drone',
    systemPrompt: 'You are a developer with full tools.',
    toolPreset: 'claude_code',
  })
  const opts = s.buildSdkOptions()
  const agentDef = opts.agents?.['agentyard-agent']
  assert(
    'claude_code drone without allowedTools: agent.tools is undefined (inherits parent)',
    agentDef !== undefined && agentDef.tools === undefined,
    `got agent.tools=${JSON.stringify(agentDef?.tools)}`,
  )
}

// ── Case 3: drone without toolPreset → only MCPs are available, no built-ins ──
{
  const s = new Session({
    id: 'test-3',
    role: 'drone',
    systemPrompt: 'You are a text-only drone.',
  })
  const opts = s.buildSdkOptions()
  assert(
    'no preset drone: parent tools = [] (no built-ins)',
    Array.isArray(opts.tools) && opts.tools.length === 0,
    `got ${JSON.stringify(opts.tools)}`,
  )
  const agentDef = opts.agents?.['agentyard-agent']
  assert(
    'no preset drone: agent.tools includes request_clarification',
    arrayContains(agentDef?.tools, CLARIFICATION),
    `got ${JSON.stringify(agentDef?.tools)}`,
  )
  assert(
    'no preset drone: agent.tools does NOT include Bash',
    !arrayContains(agentDef?.tools, 'Bash'),
  )
}

// ── Case 4: leader (no toolPreset, with extra runtime tools: assign_task + mark_node_complete) ──
{
  // The leader wires assign_task / mark_node_complete via runtimeTools.
  // We can't easily construct those tools without their factories, but we can
  // simulate them with a minimal fake — the assertion is about NAMES showing up.
  // Use objects with a `name` field that the SDK builder will expose.
  const s = new Session({
    id: 'test-4',
    role: 'leader',
    systemPrompt: 'You are the LEADER.',
    runtimeTools: [fakeTool('assign_task'), fakeTool('mark_node_complete')],
  })
  const opts = s.buildSdkOptions()
  const agentDef = opts.agents?.['agentyard-agent']
  assert(
    'leader: agent.tools includes assign_task (MCP-namespaced)',
    arrayContains(agentDef?.tools, 'mcp__ay_runtime__assign_task'),
    `got ${JSON.stringify(agentDef?.tools)}`,
  )
  assert(
    'leader: agent.tools includes mark_node_complete (MCP-namespaced)',
    arrayContains(agentDef?.tools, 'mcp__ay_runtime__mark_node_complete'),
  )
}

// ── Case 5: drone with attached scripts → script tools show in agent catalog ──
{
  const s = new Session({
    id: 'test-5',
    role: 'drone',
    systemPrompt: 'You can lint.',
    toolPreset: 'claude_code',
    allowedTools: ['Read'],
    scriptTools: [fakeTool('lint')],
  })
  const opts = s.buildSdkOptions()
  const agentDef = opts.agents?.['agentyard-agent']
  assert(
    'claude_code drone with script: agent.tools includes the script (MCP-namespaced)',
    arrayContains(agentDef?.tools, 'mcp__ay_scripts__lint'),
    `got ${JSON.stringify(agentDef?.tools)}`,
  )
  assert(
    'claude_code drone with script: still has Read',
    arrayContains(agentDef?.tools, 'Read'),
  )
  assert(
    'claude_code drone with script: still has request_clarification',
    arrayContains(agentDef?.tools, CLARIFICATION),
  )
}

// ── Case 6: model override flows through ──
{
  const s = new Session({
    id: 'test-6',
    role: 'drone',
    systemPrompt: 'pick a model',
    toolPreset: 'claude_code',
    model: 'claude-haiku-4-5-20251001',
  })
  const opts = s.buildSdkOptions()
  assert(
    'model override flows into options.model',
    opts.model === 'claude-haiku-4-5-20251001',
    `got ${opts.model}`,
  )
}

let allPass = true
for (const r of results) {
  if (r.pass) console.log(`[smoke-perm] PASS  ${r.name}`)
  else {
    console.log(`[smoke-perm] FAIL  ${r.name}\n        ${r.detail ?? '(no detail)'}`)
    allPass = false
  }
}
process.exit(allPass ? 0 : 1)
