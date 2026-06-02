/**
 * Phase A smoke test — tool library lifecycle.
 *
 * Runs against the existing "smoke-planet" planet (must point at a real git
 * repo — by default the AgentYard repo itself). The smoke does NOT create or
 * delete the planet; pre-flight just verifies one exists.
 *
 * Exercises:
 *  1. Create per-planet skill via API, verify on disk
 *  2. Edit it, verify changes persist
 *  3. Elevate (planet → global), verify move
 *  4. Fork (global → planet), verify copy
 *  5. Delete per-planet + delete global
 *  6. Adopt a .claude/agents/ entry, verify transform (mcpServers → mcps, etc.)
 *     and that the .claude/ original is left untouched
 *  7. Create per-planet MCP with ${env:VAR} placeholder, verify stored as-is
 *  8. Create per-planet Script, verify manifest.yaml on disk
 *
 * Run with: npx tsx scripts/smoke-tools.ts
 * (Assumes `npm run dev` is already running and a "smoke-planet" exists.)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const BASE = 'http://localhost:4242'
const PLANET_NAME = 'smoke-planet'
const STAMP = Date.now()
// Timestamped names so concurrent / repeated runs don't collide with each other.
const SKILL_NAME = `smoke-skill-${STAMP}`
const AGENT_NAME = `smoke-claude-agent-${STAMP}`
const MCP_NAME = `smoke-mcp-${STAMP}`
const SCRIPT_NAME = `smoke-script-${STAMP}`

interface Planet {
  id: number
  name: string
  projectPath: string
  pathExists: boolean
}

let planetId: number | null = null
let planetPath: string | null = null

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
  if (planetId === null || planetPath === null) return
  // Restore the smoke-planet's filesystem to pre-test state. Best-effort —
  // a failed test may have left a partial state; each DELETE is independent.
  await api('DELETE', `/api/planets/${planetId}/tools/skill/${SKILL_NAME}`).catch(() => {})
  await api('DELETE', `/api/global-tools/skill/${SKILL_NAME}`).catch(() => {})
  await api('DELETE', `/api/planets/${planetId}/tools/agent/${AGENT_NAME}`).catch(() => {})
  await api('DELETE', `/api/planets/${planetId}/tools/mcp/${MCP_NAME}`).catch(() => {})
  await api('DELETE', `/api/planets/${planetId}/tools/script/${SCRIPT_NAME}`).catch(() => {})
  // Remove the .claude fixture we seeded.
  const fixture = path.join(planetPath, '.claude', 'agents', `${AGENT_NAME}.md`)
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
// Setup — locate smoke-planet, seed Claude-format agent fixture
// -------------------------------------------------------------
const planets = (await fetch(`${BASE}/api/planets`).then((r) => r.json())) as Planet[]
const planet = planets.find((s) => s.name === PLANET_NAME)
if (!planet) {
  fail(
    `no planet named "${PLANET_NAME}" registered. Create one pointing at any git repo via the galaxy view first.`,
  )
}
if (!planet!.pathExists) {
  fail(`planet "${PLANET_NAME}" projectPath does not exist on disk: ${planet!.projectPath}`)
}
planetId = planet!.id
planetPath = planet!.projectPath
console.log(`[smoke] using smoke-planet #${planetId} at ${planetPath}`)

// Seed a Claude-format agent in .claude/ so we can test adoption + transform.
const claudeAgentFile = path.join(planetPath, '.claude', 'agents', `${AGENT_NAME}.md`)
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
// 1. Create per-planet skill
// -------------------------------------------------------------
const planetSkillFile = path.join(planetPath, '.agentyard', 'skills', SKILL_NAME, 'SKILL.md')
const globalSkillFile = path.join(homedir(), '.agentyard', 'skills', SKILL_NAME, 'SKILL.md')

await step('create per-planet skill', async () => {
  const r = await api('POST', `/api/planets/${planetId}/tools/skill`, {
    data: { name: SKILL_NAME, description: 'initial', body: '# initial body' },
  })
  if (!r.ok) throw new Error(`POST -> ${r.status} ${r.text}`)
  if (!existsSync(planetSkillFile)) throw new Error(`missing on disk: ${planetSkillFile}`)
  if (!readFileSync(planetSkillFile, 'utf8').includes('# initial body')) {
    throw new Error('initial body not in file')
  }
})

await step('list endpoint surfaces it with scope=planet', async () => {
  const r = await api('GET', `/api/planets/${planetId}/tools`)
  if (!r.ok) throw new Error(`GET -> ${r.status}`)
  const list = r.data as Array<{ type: string; name: string; scope: string }>
  const found = list.find((t) => t.type === 'skill' && t.name === SKILL_NAME && t.scope === 'planet')
  if (!found) throw new Error('not in list with scope=planet')
})

// -------------------------------------------------------------
// 2. Edit
// -------------------------------------------------------------
await step('edit skill', async () => {
  const r = await api('PUT', `/api/planets/${planetId}/tools/skill/${SKILL_NAME}`, {
    data: { name: SKILL_NAME, description: 'EDITED', body: '# edited body' },
  })
  if (!r.ok) throw new Error(`PUT -> ${r.status} ${r.text}`)
  const content = readFileSync(planetSkillFile, 'utf8')
  if (!content.includes('# edited body')) throw new Error('edited body not in file')
  if (!content.includes('EDITED')) throw new Error('edited description not in file')
})

// -------------------------------------------------------------
// 3. Elevate (planet → global)
// -------------------------------------------------------------
await step('elevate planet → global', async () => {
  const r = await api('POST', `/api/planets/${planetId}/tools/skill/${SKILL_NAME}/elevate`)
  if (!r.ok) throw new Error(`POST -> ${r.status} ${r.text}`)
  if (!existsSync(globalSkillFile)) throw new Error(`global file missing: ${globalSkillFile}`)
  if (existsSync(planetSkillFile)) throw new Error('per-planet file still present after elevate (should be moved)')
})

// -------------------------------------------------------------
// 4. Fork (global → planet)
// -------------------------------------------------------------
await step('fork global → planet', async () => {
  const r = await api('POST', `/api/planets/${planetId}/tools/skill/${SKILL_NAME}/fork-from-global`)
  if (!r.ok) throw new Error(`POST -> ${r.status} ${r.text}`)
  if (!existsSync(planetSkillFile)) throw new Error('per-planet file not recreated after fork')
  if (!existsSync(globalSkillFile)) throw new Error('global file removed after fork (should remain)')
})

// -------------------------------------------------------------
// 5. Delete per-planet + global
// -------------------------------------------------------------
await step('delete per-planet', async () => {
  const r = await api('DELETE', `/api/planets/${planetId}/tools/skill/${SKILL_NAME}`)
  if (!r.ok) throw new Error(`DELETE -> ${r.status}`)
  if (existsSync(planetSkillFile)) throw new Error('per-planet file still present after delete')
})

await step('delete global', async () => {
  const r = await api('DELETE', `/api/global-tools/skill/${SKILL_NAME}`)
  if (!r.ok) throw new Error(`DELETE -> ${r.status}`)
  if (existsSync(globalSkillFile)) throw new Error('global file still present after delete')
})

// -------------------------------------------------------------
// 6. Adopt .claude/agents/* with format transform
// -------------------------------------------------------------
const adoptedAgentFile = path.join(planetPath, '.agentyard', 'agents', `${AGENT_NAME}.md`)

await step('catalog list shows .claude agent', async () => {
  const r = await api('GET', `/api/planets/${planetId}/tools`)
  if (!r.ok) throw new Error(`GET -> ${r.status}`)
  const list = r.data as Array<{ type: string; name: string; scope: string }>
  const found = list.find(
    (t) => t.type === 'agent' && t.name === AGENT_NAME && t.scope === 'claude-project',
  )
  if (!found) throw new Error('catalog agent not in list')
})

await step('adopt .claude agent transforms format and leaves origin untouched', async () => {
  const r = await api('POST', `/api/planets/${planetId}/tools/adopt`, {
    sourceScope: 'claude-project',
    type: 'agent',
    name: AGENT_NAME,
    target: 'planet',
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
// 7. Create per-planet MCP with ${env:VAR} placeholder
// -------------------------------------------------------------
const mcpFile = path.join(planetPath, '.agentyard', 'mcps', `${MCP_NAME}.json`)

await step('create per-planet MCP with ${env:VAR} placeholder', async () => {
  const r = await api('POST', `/api/planets/${planetId}/tools/mcp`, {
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
// 8. Create per-planet Script
// -------------------------------------------------------------
const scriptManifestFile = path.join(planetPath, '.agentyard', 'scripts', SCRIPT_NAME, 'manifest.yaml')

await step('create per-planet script', async () => {
  const r = await api('POST', `/api/planets/${planetId}/tools/script`, {
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
