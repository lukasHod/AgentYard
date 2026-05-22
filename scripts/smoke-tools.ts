/**
 * Phase A smoke test — tool library lifecycle.
 *
 * Runs against the existing "smoke-ship" ship (must point at a real git repo
 * — by default the AgentYard repo itself). The smoke does NOT create or
 * delete the ship; pre-flight just verifies one exists.
 *
 * Exercises:
 *  1. Create per-ship skill via API, verify on disk
 *  2. Edit it, verify changes persist
 *  3. Elevate (ship → global), verify move
 *  4. Fork (global → ship), verify copy
 *  5. Delete per-ship + delete global
 *  6. Adopt a .claude/agents/ entry, verify transform (mcpServers → mcps, etc.)
 *     and that the .claude/ original is left untouched
 *  7. Create per-ship MCP with ${env:VAR} placeholder, verify stored as-is
 *  8. Create per-ship Script, verify manifest.yaml on disk
 *
 * Run with: npx tsx scripts/smoke-tools.ts
 * (Assumes `npm run dev` is already running and a "smoke-ship" exists.)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const BASE = 'http://localhost:4242'
const SHIP_NAME = 'smoke-ship'
const STAMP = Date.now()
// Timestamped names so concurrent / repeated runs don't collide with each other.
const SKILL_NAME = `smoke-skill-${STAMP}`
const AGENT_NAME = `smoke-claude-agent-${STAMP}`
const MCP_NAME = `smoke-mcp-${STAMP}`
const SCRIPT_NAME = `smoke-script-${STAMP}`

interface Ship {
  id: number
  name: string
  projectPath: string
  pathExists: boolean
}

let shipId: number | null = null
let shipPath: string | null = null

function fail(msg: string): never {
  console.error(`[smoke] FAIL: ${msg}`)
  void cleanup().finally(() => process.exit(1))
  setTimeout(() => process.exit(1), 5_000)
  throw new Error(msg)
}

async function api(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const init: RequestInit = { method, headers: body ? { 'Content-Type': 'application/json' } : undefined }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${url}`, init)
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* keep text */
  }
  return { ok: res.ok, status: res.status, data, text }
}

async function cleanup(): Promise<void> {
  if (shipId === null || shipPath === null) return
  // Restore the smoke-ship's filesystem to pre-test state. Best-effort —
  // a failed test may have left a partial state; each DELETE is independent.
  await api('DELETE', `/api/ships/${shipId}/tools/skill/${SKILL_NAME}`).catch(() => {})
  await api('DELETE', `/api/global-tools/skill/${SKILL_NAME}`).catch(() => {})
  await api('DELETE', `/api/ships/${shipId}/tools/agent/${AGENT_NAME}`).catch(() => {})
  await api('DELETE', `/api/ships/${shipId}/tools/mcp/${MCP_NAME}`).catch(() => {})
  await api('DELETE', `/api/ships/${shipId}/tools/script/${SCRIPT_NAME}`).catch(() => {})
  // Remove the .claude fixture we seeded.
  const fixture = path.join(shipPath, '.claude', 'agents', `${AGENT_NAME}.md`)
  if (existsSync(fixture)) {
    try {
      rmSync(fixture, { force: true })
    } catch {
      /* ignore */
    }
  }
}

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`[smoke] ✓ ${label}`)
  } catch (e) {
    fail(`${label} — ${e instanceof Error ? e.message : String(e)}`)
  }
}

// -------------------------------------------------------------
// Setup — locate smoke-ship, seed Claude-format agent fixture
// -------------------------------------------------------------
const ships = (await fetch(`${BASE}/api/ships`).then((r) => r.json())) as Ship[]
const ship = ships.find((s) => s.name === SHIP_NAME)
if (!ship) {
  fail(
    `no ship named "${SHIP_NAME}" registered. Create one pointing at any git repo via the galaxy view first.`,
  )
}
if (!ship!.pathExists) {
  fail(`ship "${SHIP_NAME}" projectPath does not exist on disk: ${ship!.projectPath}`)
}
shipId = ship!.id
shipPath = ship!.projectPath
console.log(`[smoke] using smoke-ship #${shipId} at ${shipPath}`)

// Seed a Claude-format agent in .claude/ so we can test adoption + transform.
const claudeAgentFile = path.join(shipPath, '.claude', 'agents', `${AGENT_NAME}.md`)
mkdirSync(path.dirname(claudeAgentFile), { recursive: true })
writeFileSync(
  claudeAgentFile,
  `---
name: ${AGENT_NAME}
description: Test agent for the smoke adopt flow
tools: ['Read', 'Edit']
mcpServers: []
---
You are a smoke-test agent.
`,
  'utf8',
)

// -------------------------------------------------------------
// 1. Create per-ship skill
// -------------------------------------------------------------
const shipSkillFile = path.join(shipPath, '.agentyard', 'skills', SKILL_NAME, 'SKILL.md')
const globalSkillFile = path.join(homedir(), '.agentyard', 'skills', SKILL_NAME, 'SKILL.md')

await step('create per-ship skill', async () => {
  const r = await api('POST', `/api/ships/${shipId}/tools/skill`, {
    data: { name: SKILL_NAME, description: 'initial', body: '# initial body' },
  })
  if (!r.ok) throw new Error(`POST -> ${r.status} ${r.text}`)
  if (!existsSync(shipSkillFile)) throw new Error(`missing on disk: ${shipSkillFile}`)
  if (!readFileSync(shipSkillFile, 'utf8').includes('# initial body')) {
    throw new Error('initial body not in file')
  }
})

await step('list endpoint surfaces it with scope=ship', async () => {
  const r = await api('GET', `/api/ships/${shipId}/tools`)
  if (!r.ok) throw new Error(`GET -> ${r.status}`)
  const list = r.data as Array<{ type: string; name: string; scope: string }>
  const found = list.find((t) => t.type === 'skill' && t.name === SKILL_NAME && t.scope === 'ship')
  if (!found) throw new Error('not in list with scope=ship')
})

// -------------------------------------------------------------
// 2. Edit
// -------------------------------------------------------------
await step('edit skill', async () => {
  const r = await api('PUT', `/api/ships/${shipId}/tools/skill/${SKILL_NAME}`, {
    data: { name: SKILL_NAME, description: 'EDITED', body: '# edited body' },
  })
  if (!r.ok) throw new Error(`PUT -> ${r.status} ${r.text}`)
  const content = readFileSync(shipSkillFile, 'utf8')
  if (!content.includes('# edited body')) throw new Error('edited body not in file')
  if (!content.includes('EDITED')) throw new Error('edited description not in file')
})

// -------------------------------------------------------------
// 3. Elevate (ship → global)
// -------------------------------------------------------------
await step('elevate ship → global', async () => {
  const r = await api('POST', `/api/ships/${shipId}/tools/skill/${SKILL_NAME}/elevate`)
  if (!r.ok) throw new Error(`POST -> ${r.status} ${r.text}`)
  if (!existsSync(globalSkillFile)) throw new Error(`global file missing: ${globalSkillFile}`)
  if (existsSync(shipSkillFile)) throw new Error('per-ship file still present after elevate (should be moved)')
})

// -------------------------------------------------------------
// 4. Fork (global → ship)
// -------------------------------------------------------------
await step('fork global → ship', async () => {
  const r = await api('POST', `/api/ships/${shipId}/tools/skill/${SKILL_NAME}/fork-from-global`)
  if (!r.ok) throw new Error(`POST -> ${r.status} ${r.text}`)
  if (!existsSync(shipSkillFile)) throw new Error('per-ship file not recreated after fork')
  if (!existsSync(globalSkillFile)) throw new Error('global file removed after fork (should remain)')
})

// -------------------------------------------------------------
// 5. Delete per-ship + global
// -------------------------------------------------------------
await step('delete per-ship', async () => {
  const r = await api('DELETE', `/api/ships/${shipId}/tools/skill/${SKILL_NAME}`)
  if (!r.ok) throw new Error(`DELETE -> ${r.status}`)
  if (existsSync(shipSkillFile)) throw new Error('per-ship file still present after delete')
})

await step('delete global', async () => {
  const r = await api('DELETE', `/api/global-tools/skill/${SKILL_NAME}`)
  if (!r.ok) throw new Error(`DELETE -> ${r.status}`)
  if (existsSync(globalSkillFile)) throw new Error('global file still present after delete')
})

// -------------------------------------------------------------
// 6. Adopt .claude/agents/* with format transform
// -------------------------------------------------------------
const adoptedAgentFile = path.join(shipPath, '.agentyard', 'agents', `${AGENT_NAME}.md`)

await step('catalog list shows .claude agent', async () => {
  const r = await api('GET', `/api/ships/${shipId}/tools`)
  if (!r.ok) throw new Error(`GET -> ${r.status}`)
  const list = r.data as Array<{ type: string; name: string; scope: string }>
  const found = list.find(
    (t) => t.type === 'agent' && t.name === AGENT_NAME && t.scope === 'claude-project',
  )
  if (!found) throw new Error('catalog agent not in list')
})

await step('adopt .claude agent transforms format and leaves origin untouched', async () => {
  const r = await api('POST', `/api/ships/${shipId}/tools/adopt`, {
    sourceScope: 'claude-project',
    type: 'agent',
    name: AGENT_NAME,
    target: 'ship',
  })
  if (!r.ok) throw new Error(`POST -> ${r.status} ${r.text}`)
  if (!existsSync(adoptedAgentFile)) throw new Error(`adopted file missing: ${adoptedAgentFile}`)
  const adopted = readFileSync(adoptedAgentFile, 'utf8')
  if (adopted.includes('mcpServers:')) {
    throw new Error('adopted frontmatter still uses Claude\'s `mcpServers:` — should have been mapped')
  }
  if (!adopted.includes('mcps:')) throw new Error('adopted frontmatter missing `mcps:`')
  if (!adopted.includes('role:')) throw new Error('adopted frontmatter missing `role:`')
  if (!adopted.includes('toolPreset:')) throw new Error('adopted frontmatter missing `toolPreset:`')
  // Original must be untouched.
  const original = readFileSync(claudeAgentFile, 'utf8')
  if (original.includes('mcps:')) throw new Error('.claude/ original was modified by adopt')
  if (!original.includes('mcpServers:')) throw new Error('.claude/ original lost mcpServers field')
})

// -------------------------------------------------------------
// 7. Create per-ship MCP with ${env:VAR} placeholder
// -------------------------------------------------------------
const mcpFile = path.join(shipPath, '.agentyard', 'mcps', `${MCP_NAME}.json`)

await step('create per-ship MCP with ${env:VAR} placeholder', async () => {
  const r = await api('POST', `/api/ships/${shipId}/tools/mcp`, {
    data: {
      name: MCP_NAME,
      description: 'smoke test mcp',
      transport: 'stdio',
      command: 'npx',
      args: ['@example/mcp'],
      env: { TOKEN: '${env:NOT_SET_IN_TEST}' },
    },
  })
  if (!r.ok) throw new Error(`POST -> ${r.status} ${r.text}`)
  if (!existsSync(mcpFile)) throw new Error('mcp file not on disk')
  const json = JSON.parse(readFileSync(mcpFile, 'utf8'))
  if (json.env?.TOKEN !== '${env:NOT_SET_IN_TEST}') {
    throw new Error(`mcp env placeholder mangled: ${JSON.stringify(json.env)}`)
  }
})

// -------------------------------------------------------------
// 8. Create per-ship Script
// -------------------------------------------------------------
const scriptManifestFile = path.join(shipPath, '.agentyard', 'scripts', SCRIPT_NAME, 'manifest.yaml')

await step('create per-ship script', async () => {
  const r = await api('POST', `/api/ships/${shipId}/tools/script`, {
    data: {
      name: SCRIPT_NAME,
      description: 'smoke test script',
      cmd: 'echo {greeting}',
      args: [{ name: 'greeting', description: 'a greeting', required: true }],
    },
  })
  if (!r.ok) throw new Error(`POST -> ${r.status} ${r.text}`)
  if (!existsSync(scriptManifestFile)) throw new Error('manifest.yaml not on disk')
  const yaml = readFileSync(scriptManifestFile, 'utf8')
  if (!yaml.includes('cmd:') || !yaml.includes('echo')) throw new Error('manifest missing cmd')
})

// -------------------------------------------------------------
// Done
// -------------------------------------------------------------
await cleanup()
console.log('[smoke] PASS — Phase A tool lifecycle verified end-to-end')
process.exit(0)
