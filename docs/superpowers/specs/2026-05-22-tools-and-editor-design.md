# Tools and Workflow Editor — Design

Spec produced via the `obra/superpowers` brainstorming methodology. Five sections were confirmed section-by-section, then a 12-point user review surfaced fixes that have been applied to this version.

## Context

Today an AgentYard workflow has:
- Fixed node "kinds" (analyze/develop/deploy/custom), styled cosmetically in the editor.
- Per-node `drones: DroneSlot[]` defining the leader's team as anonymous roles.
- Per-node `skills: string[]` attaching skill bodies into every drone's system prompt.
- A global skills library at `~/.agentyard/skills/` shared across all ships.
- No MCP integration in the UI; no scripts; no per-ship tooling; no agent presets.

The user wants the orchestrator to feel like a real shipyard where each ship can be configured with its own toolset, and a workflow editor that supports growth (new node types, branching, custom scripts). This spec replaces the static drone-slot model with a first-class tool library, agent presets, and an extensible node-type system.

Out of scope (logged as follow-ups):
- **Watchers** — scheduled polling triggers that create features. Separate sub-project.
- **Loop nodes inside a workflow** — dropped by user.
- **Pure rule-based conditional nodes** — branching is handled by AI leaders.
- **OS keyring integration for secrets** — punted to a later phase.

## Locked decisions

| Decision | Choice |
|---|---|
| Tool types in v1 | skill, mcp, script, agent (4 total) |
| `<ship>` resolution | `ship.projectPath` — `<ship>/.agentyard/` is a sibling of `.git/`. **Deleting the project repo deletes the per-ship tools.** |
| Catalog sources | `<ship>/.claude/` (project-level) + `~/.claude/` (user-level). Both read-only. |
| AgentYard scopes | `<ship>/.agentyard/` (per-ship editable) + `~/.agentyard/` (global editable) |
| Lifecycle actions | Adopt, Elevate, Fork — see lifecycle table below |
| Resolution | per-ship → global → error. Catalog never resolves directly; must be adopted first. |
| Agent role | An agent IS a drone preset. Workflow nodes connect to agents directly; drone slots are gone. |
| Capability attachment | Skills / MCPs / scripts attach to AGENTS, not nodes. Connecting an agent brings its full load-out. |
| Node types | Two: `ai` (LLM-driven) and `custom` (deterministic). First custom subtype: `script`. |
| Branching | AI leaders pass `next?: string[]` in `mark_node_complete`. Pulled into Phase B. |
| Script body | Implicit `script.sh` dropped. Manifest `cmd:` is authoritative — for non-trivial logic, write `cmd: "bash script.sh {filter}"`. |
| Secrets | `${env:VAR}` substitution in MCP configs at runtime. Optional `~/.agentyard/.secrets/secrets.env` (gitignored) auto-loaded at startup. |
| Library freshness | Explicit endpoint, no in-memory cache. Rescan disk on every list call. |
| MCP namespace split | Runtime tools → `mcp__ay_runtime__*`. User scripts → `mcp__ay_scripts__*`. (Was: `mcp__agentyard__*` — collision-prone.) |
| Migration | Wipe & reseed. Drop `skills` + `node_skills` SQLite tables. Set `features.workflow_id` NULL on wipe. |

## Conceptual model

```
   READ-ONLY CATALOG                       AGENTYARD-MANAGED
   ─────────────────                       ─────────────────
   ~/.claude/{agents,skills}/  ──┐
                                 ├──► ~/.agentyard/{...}/      (global, editable)
   <ship>/.claude/{...}/       ──┤            │
                                 │            │ resolution: per-ship → global
                                 ├──► <ship>/.agentyard/{...}/ (per-ship, editable)
   adopt / elevate / fork ───────┘
                                              │
                                              ▼
                            ┌───────────────────────────────────┐
                            │      WORKFLOW (per ship)          │
                            │                                   │
                            │  [Analyze] → [Classify] →         │
                            │    AI         AI (branches)       │
                            │    agents:    agents: [classifier]│
                            │    [planner,            │         │
                            │     reviewer]      ┌────┴────┐    │
                            │                    ▼         ▼    │
                            │                 [Develop] [Debug] │
                            │                    AI       AI    │
                            │                  agents:  agents: │
                            │                    │         │    │
                            │                    └────┬────┘    │
                            │                         ▼         │
                            │                     [Deploy]      │
                            │                       AI          │
                            └───────────────────────────────────┘
```

`<ship>` everywhere below resolves to `ship.projectPath` from the SQLite `ships` table.

## Per-tool schemas

### Skill

`<ship>/.agentyard/skills/<name>/SKILL.md` (per-ship) or `~/.agentyard/skills/<name>/SKILL.md` (global):

```
---
name: react-best-practices
description: One-line description
---

# Skill body
Markdown instructions loaded into the drone's system prompt.
```

Catalog sources scanned in this order: `<ship>/.claude/skills/<name>/SKILL.md`, `~/.claude/skills/<name>/SKILL.md` (Claude Code's actual user-level convention).

### MCP

One file per server. `<ship>/.agentyard/mcps/<name>.json`:

```json
{
  "name": "github",
  "description": "GitHub MCP — issues, PRs, repos",
  "transport": "stdio",
  "command": "npx",
  "args": ["@modelcontextprotocol/server-github"],
  "env": { "GITHUB_TOKEN": "${env:GITHUB_TOKEN}" }
}
```

- HTTP variant uses `"transport": "http"`, `"url"`, `"headers"`.
- **`${env:VAR}` substitution** is resolved at MCP-server-spawn time from `process.env`. Never persisted, never logged. Applies to any string field in the config (env values, args, urls, headers).
- Catalog sources: `<ship>/.claude/mcp.json` (Claude project-level single-file format — AgentYard splits each entry as a virtual catalog item) and `~/.claude/mcp.json` (user-level, same format).

### Script

`<ship>/.agentyard/scripts/<name>/manifest.yaml`:

```yaml
name: run-tests
description: "Run vitest unit tests, return failures only"
cmd: "npm test -- --reporter=json"
args:
  - name: filter
    description: "Substring to filter tests by"
    required: false
```

`cmd:` is the **only** thing AgentYard executes. There is no implicit `script.sh` execution.

For non-trivial logic, place a script file beside the manifest and reference it explicitly:

```yaml
cmd: "bash script.sh {filter}"
```

…with `<name>/script.sh` next to the manifest. Works the same on Windows, macOS, and Linux as long as the user's shell can resolve the interpreter.

When attached to an agent, AgentYard registers an MCP-style custom tool named `mcp__ay_scripts__<name>`; calling it substitutes `{argName}` tokens (from the call's args, themselves substituted with `{task}` / `{upstream_outputs}` at node-render time), then runs `cmd` via the shell inside the worktree, returning stdout/stderr.

There is no Claude Code catalog source for scripts — they are AgentYard-only.

### Agent

Claude-compatible markdown — frontmatter + body. `<ship>/.agentyard/agents/<name>.md`:

```
---
name: developer
description: "Implements features by editing code in the worktree"
role: developer
model: opus
toolPreset: claude_code
allowedTools: ['Read','Edit','Write','Glob','Grep','Bash']
skills: [react-best-practices, agentyard-style]
mcps: [github]
scripts: [run-tests]
---

You are the developer drone on the AgentYard team. When the leader assigns you a task,
read the relevant files first, then make focused edits…
```

**Compatibility with `.claude/agents/*.md` is via transform, not copy.** Claude Code's agent frontmatter uses `mcpServers` (we use `mcps`); has no `role`, `toolPreset`, or `scripts` fields. Adopting from a `.claude/` agent runs through `lifecycle.adopt` which:
1. Parses the source frontmatter
2. Maps `mcpServers` → `mcps`
3. Fills `role` from the file's basename (e.g. `developer.md` → `role: developer`)
4. Defaults `toolPreset: claude_code` (preserves Claude Code's general expectation that agents have file tools)
5. Defaults `scripts: []`
6. Writes a new file in `.agentyard/agents/` with the transformed frontmatter + the original body unchanged

The `.claude/` original is untouched.

### Shadowing rules

| Both exist | Wins |
|---|---|
| `<ship>/.agentyard/X` + `~/.agentyard/X` | per-ship |
| `<ship>/.claude/X` + `<ship>/.agentyard/X` | per-ship (`.claude` hidden from catalog) |
| `~/.claude/X` + `~/.agentyard/X` | global (`~/.claude` hidden from catalog) |
| `<ship>/.claude/X` + `~/.claude/X` | per-ship catalog entry shown; user-level catalog entry hidden |

Resolution at runtime: per-ship `.agentyard` → global `~/.agentyard` → error. Catalog never resolves directly.

## Library UI

### Two entry points

1. **Ship cockpit → Tools tab** (primary): shows all four scopes for the current ship; all lifecycle actions available.
2. **Galaxy HUD → "library" button** (new): shows global `~/.agentyard/` + user catalog `~/.claude/` only; lets you manage global tools without a ship selected.

### Freshness

Both entry points call `GET /api/ships/:id/tools` (cockpit) or `GET /api/global-tools` (galaxy). Each call rescans the relevant scopes from disk — **no in-memory cache**. Cheap; filesystem reads are fast and libraries stay small. The current `skills.ts` in-memory cache pattern is dropped.

### List rendering

Sectioned by type, each tool tagged with its source and offered relevant actions:

```
TOOLS                                                     [+ create new]

▾ SKILLS (5)
   • react-best-practices    [agentyard]      [edit] [delete] [↑ elevate]
   • agentyard-style         [agentyard]      [edit] [delete] [↑ elevate]
   • jira-master             [global]         [edit] [delete] [↓ fork]
   • security-review         [.claude project] [adopt → ship]
   • code-style              [.claude user]    [adopt → global]

▾ AGENTS (2)
   • developer               [global]         [edit] [delete] [↓ fork]
   • reviewer                [.claude project] [adopt → ship]

▾ MCPS / SCRIPTS (similar)
```

Four badges:
- `[agentyard]` — `<ship>/.agentyard/`, fully editable
- `[global]` — `~/.agentyard/`, fully editable
- `[.claude project]` — `<ship>/.claude/`, read-only catalog
- `[.claude user]` — `~/.claude/`, read-only catalog

### Adoption defaults

Where an adopted file lands depends on the catalog source:

| Catalog source | Default adoption target | User override? |
|---|---|---|
| `<ship>/.claude/X` | `<ship>/.agentyard/X` | yes, can target global instead |
| `~/.claude/X` | `~/.agentyard/X` | yes, can target per-ship instead |

### Lifecycle actions

| From → To | Action | Effect |
|---|---|---|
| `<ship>/.claude` → `<ship>/.agentyard` | Adopt → ship | Parse-transform-write into `.agentyard/`. `.claude/` original untouched. |
| `~/.claude` → `~/.agentyard` | Adopt → global | Same, into global. |
| `<ship>/.agentyard` → `~/.agentyard` | Elevate | Move file. Workflow refs (name-only) auto-resolve to global on next run. |
| `~/.agentyard` → `<ship>/.agentyard` | Fork to ship | Copy. Per-ship now shadows global for this ship only. |

Delete on `[agentyard]` or `[global]` removes the file (with confirm). If a `[.claude]` original existed and was shadowed, it reappears in the catalog.

### Edit / create form

`[+ create new]` opens a type picker → scope picker (defaults: per-ship in cockpit, global in galaxy view) → type-specific form.

| Type | Form fields |
|---|---|
| Skill | name, description, body (markdown textarea) |
| MCP | name, description, transport radio, command+args+env *or* url+headers (`${env:VAR}` allowed in any string field) |
| Script | name, description, cmd, optional `script.sh` body (separate file written next to manifest if non-empty), args schema rows |
| Agent | name, description, role, model dropdown, toolPreset radio, allowedTools multiselect (when claude_code), skills/mcps/scripts multiselects of the ship's library, system prompt textarea (body) |

Save writes to disk. Cancel returns to list.

### Secrets layering

Two mechanisms work together:

1. **`${env:VAR}` substitution** — any string field in any tool file. Resolved at runtime from `process.env`. Never persisted, never logged.
2. **Optional `~/.agentyard/.secrets/secrets.env`** — simple `KEY=value` file (gitignored). AgentYard auto-loads it into `process.env` at server startup if it exists. Gives the user an AgentYard-specific home for secrets, decoupled from per-project ecosystems (.NET, Go, mobile, etc. don't use `.env`).

Recommended workflow: put real tokens in `~/.agentyard/.secrets/secrets.env`, reference them via `${env:VAR}` in MCP configs. Per-ship MCP files can then live in the repo without containing secrets.

## Workflow editor changes

### Schema change

```ts
// before
WorkflowNode {
  kind: 'analyze' | 'develop' | 'deploy' | 'custom'
  drones: DroneSlot[]
  skills: string[]
  prompt, title, position
}

// after
WorkflowNode {
  id, title, position
  type: 'ai' | 'custom'

  // type === 'ai'
  prompt?: string
  agents?: string[]              // names; resolver walks per-ship → global

  // type === 'custom'
  customType?: 'script' /* | future */
  scriptName?: string
  args?: Record<string, string>
}
```

`kind`, `drones`, `skills` are removed. All capability attachment lives on agents now.

### Editor side panel

For an AI node:

```
node:    Develop                                   [delete node]
type:    [ai ▾]
title:   [Develop                                    ]
prompt:  [ multiline textarea, supports {task}      ]
         [ and {upstream_outputs}                    ]

AGENTS (2)                                          [+]
  ☑ developer        [agentyard]
  ☑ reviewer         [global]
  ☐ security-auditor [global]      ← available, click to connect
```

Multiselect calls `GET /api/ships/:id/tools` for fresh data each time the panel opens; no cached options list.

For a script node:

```
node:    Run tests                                 [delete node]
type:    [custom: script ▾]
title:   [Run tests                                 ]

SCRIPT
  name:  [run-tests ▾]              ← picker from this ship's scripts
ARGS
  filter: [{task}]                  ← arg field per script's manifest
```

### Palette

```
AI                       CUSTOM
  ⊕ AI node                ⊕ Script
                           (future: wait / http / parallel / …)
```

AI nodes cyan border; script nodes amber.

### Node lifecycle

- **Add** — drag from palette or "+ node" button
- **Rename** — edit `title` in side panel
- **Delete** — button + confirm, cascades edge cleanup
- **Edit edges** — drag handle → handle adds; click edge + Delete key removes

### Runtime — AI node execution

1. Executor resolves each `node.agents[name]`:
   - First `<ship>/.agentyard/agents/<name>.md`
   - Then `~/.agentyard/agents/<name>.md`
   - Error if neither exists
2. For each resolved agent: spawn drone session with the agent's
   - system prompt (body)
   - skills (loaded via `renderSkillContext`)
   - mcps (registered as MCP servers in the SDK options; `${env:VAR}` resolved)
   - scripts (registered as `mcp__ay_scripts__<name>` custom tools)
   - allowedTools, model, toolPreset
3. Spawn the leader with `mcp__ay_runtime__assign_task` (closed over exactly these drones), `mcp__ay_runtime__mark_node_complete`, `mcp__ay_runtime__request_clarification`
4. Leader's system prompt = `node.prompt` rendered with `{task}` and `{upstream_outputs}`
5. `assign_task("not-in-roster", ...)` returns an error tool_result.

### Runtime — Script node execution

1. Executor resolves `node.scriptName` → script tool (per-ship → global)
2. Render `args` map with `{task}` / `{upstream_outputs}` substitution
3. Render `cmd` with `{argName}` substitution from rendered args
4. Run via shell inside the worktree (cwd = worktree.path)
5. Capture stdout; non-zero exit → node fails with stderr as the error message
6. On success, mark node complete with stdout (truncated if >32KB) as summary
7. Custom nodes always follow ALL outgoing edges (no branching)

### Branching (AI nodes only)

`mcp__ay_runtime__mark_node_complete` tool gains an optional `next?: string[]` parameter:

```ts
mark_node_complete({
  summary: string,
  outputs?: Record<string, string>,
  next?: string[]
})
```

- Omitted → executor follows all outgoing edges (linear default)
- Specified → executor follows only those listed
- Constraint: each name in `next` must be a direct downstream node id (in the current node's outgoing edges). Non-adjacent / upstream targets → rejected with an error tool_result.

To enforce adjacency, the `createMarkNodeCompleteTool` factory now takes `{ nodeId, outgoingNodeIds }` so it can validate at call time.

### Executor rewrite (per-run reachability)

The current `core/executor.ts` Kahn topo sort walks ALL nodes linearly. Branching requires per-run reachability tracking:

```ts
function runWorkflow(workflow, opts) {
  const order = topoSort(workflow.graph)
  // Seed with all root nodes (those with no incoming edges).
  const incoming = countIncomingPerNode(workflow.graph)
  const reachable = new Set<string>(
    order.filter((n) => incoming.get(n.id) === 0).map((n) => n.id),
  )
  for (const node of order) {
    if (!reachable.has(node.id)) continue            // skipped by upstream branch choice
    const result = await runNode(node, ...)
    const chosen = (node.type === 'ai' && result.next)
      ? result.next
      : outgoingNodeIds(workflow.graph, node.id)     // custom nodes / unspecified: all
    for (const n of chosen) reachable.add(n)
  }
}
```

This is the bulk of Phase B's executor work — adding `next` to the tool is the easy part.

## Migration plan

On next server start, after schema bump:

1. **Drop tables** — DROP `skills`, DROP `node_skills` (both orphaned; library is filesystem-canonical now)
2. **Wipe workflows** — DELETE FROM workflows. **No skip-if-exists branch.** Schema-shape change (kind→type, drones→agents, skill removal) makes any pre-migration row incompatible. Set `features.workflow_id = NULL` on the same transaction for the (small handful of) feature rows that referenced now-gone workflows.
3. **Reseed default workflow** — insert the new default with `type: 'ai'` nodes named `Analyze` / `Develop` / `Deploy`, each referencing a default agent set.
4. **Seed default agents (global)** — write `~/.agentyard/agents/{planner,reviewer,developer,tester,deployer}.md` if they don't already exist. Sensible default prompts, `toolPreset: claude_code` for the workers, `toolPreset: none` for the planner.
5. **Skills** — existing `~/.agentyard/skills/` stays untouched (format unchanged; it just becomes the new "global skills" location).

## Phased implementation

Three phases. Branching moved from C into B per review.

### Phase A — Tool library foundation (~5 days)
- `src/core/schema.ts`: ToolType, ToolScope, ToolRef, per-type metadata + body shapes
- `src/server/tools/{paths,scanner,resolver,lifecycle,crud}.ts` — pure functions
- `src/server/secrets.ts` — `${env:VAR}` substitution + `~/.agentyard/.secrets/secrets.env` autoload
- REST endpoints: `GET /api/ships/:id/tools`, `GET /api/global-tools`, POST create, PUT edit, DELETE; POST adopt / elevate / fork
- Drop old `/api/skills`* endpoints (subsumed)
- Ship cockpit Tools tab UI rewrite (sectioned list, badges, actions)
- Galaxy HUD library button + global-only view
- Per-type editor forms (Skill, MCP, Script, Agent)
- Phase A smoke: create per-ship skill → edit → elevate → fork-back → adopt-from-catalog → delete

### Phase B — Workflow editor + agent attachment + branching (~7 days)
*Was 4 days; bumped to 7 to include branching (per review #3) and UI ripple (#11).*

- Schema migration: drop tables, wipe workflows, reseed defaults, seed default agents
- `WorkflowNode` schema change (kind→type, drones→agents, drop skills)
- Touched UI files: `EditorView.tsx` (palette, type selector, AI form, script form, drone/skill badges removed), `ShipDetailsPanel.tsx`, `RunView.tsx`, `AgentChat.tsx` (label render), `GameCanvas.tsx` (galaxy library button)
- Touched runtime files: `runWorkflowOnSessions.ts` (switch on type, materialize agents), `Session.ts` (per-agent skills/mcps/scripts in opts; MCP namespace split to `mcp__ay_runtime__*`), `requestClarification.ts` + `assignTask.ts` + `markNodeComplete.ts` (renamed mcp namespace; markNodeComplete factory takes `{ nodeId, outgoingNodeIds }` for adjacency check)
- Touched core files: `executor.ts` (per-run reachability rewrite — bulk of the work), `schema.ts` (workflow shape)
- Phase B smoke: build a branching workflow (Analyze → Classify → Develop|Debug → Deploy), run two features (one bug, one feature), verify each follows the correct branch and skipped nodes don't execute

### Phase C — Custom node runtime (~1 day)
*Was 2 days; trimmed because branching moved out.*

- `src/server/runtime/scriptRuntime.ts` — `cmd` substitution, shell execution in worktree, stdout/stderr capture
- Editor: script node palette entry + side panel form
- Default workflow gets a sample script node (e.g. "lint" before develop)
- Phase C smoke: workflow with a script node runs the script, captures output, passes it downstream

Total ~13 days focused work (was ~11; net +2 from honesty about branching).

## Verification (full)

End-to-end after Phase C:
1. Fresh install, no ship → register a ship pointing at any git repo → cockpit opens with Tools tab showing seeded global agents/skills
2. Create a per-ship skill → it appears with `[agentyard]` badge; the global library on the galaxy HUD does NOT show it
3. Elevate that skill → moves to `~/.agentyard/skills/`, appears with `[global]` badge, visible in galaxy HUD library
4. Fork to ship → creates a per-ship copy that shadows the global; both visible with separate badges
5. Create a project-level `.claude/agents/test.md` outside AgentYard → it shows up in the catalog as `[.claude project]` → adopt → lands in `<ship>/.agentyard/agents/test.md` with transformed frontmatter (`mcps`/`role`/`toolPreset`/`scripts` defaults added); original `.claude/` file unchanged
6. Build a branching workflow: `Analyze → Classify → (Develop | Debug) → Deploy`. Run a feature with task "fix the login bug" → Classify routes to Debug; Develop is skipped; Deploy executes.
7. Run a feature with task "add dark mode toggle" → Classify routes to Develop; Debug is skipped.
8. Add a script node "run-tests" between Develop and Deploy → it runs `npm test`, captures output, passes to Deploy as upstream_outputs.
9. Create an MCP referencing `${env:GITHUB_TOKEN}` → without the env var set: leader chat shows the MCP failed to initialize with a clear error. Set the var via `~/.agentyard/.secrets/secrets.env` → restart server → MCP works.
10. Two scripts with the same name in different agents — verify both materialize as `mcp__ay_scripts__<name>` in their respective drone sessions without colliding (per-session MCP servers).

Unit/integration:
- Resolver tests (per-ship overrides global; catalog never resolves)
- Adopt / Elevate / Fork (filesystem state correctness; Claude→AgentYard agent frontmatter transform)
- `${env:VAR}` substitution (basic, nested, missing-var error)
- Branching adjacency check (rejecting non-adjacent `next` ids)
- Per-run reachability (skipped nodes don't execute; downstream of skipped also skipped unless reached by another path)

## Critical files

**New:**
- `src/core/schema.ts` — additions (extending existing file)
- `src/server/tools/paths.ts`
- `src/server/tools/scanner.ts`
- `src/server/tools/resolver.ts`
- `src/server/tools/lifecycle.ts`
- `src/server/tools/crud.ts`
- `src/server/secrets.ts` — env var loader + substitution helper
- `src/server/runtime/scriptRuntime.ts` — Phase C
- `src/client/views/ToolEditor.tsx` — the tabbed form (skill/mcp/script/agent)

**Modified:**
- `src/server/skills.ts` — remove (subsumed by new scanner/resolver); leave a thin shim or delete entirely
- `src/server/db.ts` — drop `skills` + `node_skills` table creation; migration to drop existing
- `src/server/workflows.ts` — wipe-and-reseed migration; new default workflow shape
- `src/server/server.ts` — remove old `/api/skills*` routes, add tool routes
- `src/server/runtime/Session.ts` — accept per-agent skills/mcps/scripts; MCP namespace `mcp__ay_runtime__*` (rename of constant)
- `src/server/runtime/runWorkflowOnSessions.ts` — switch on `node.type`; materialize agent definitions (not drone slots)
- `src/server/runtime/tools/requestClarification.ts` — namespace rename to `ay_runtime`
- `src/server/runtime/tools/assignTask.ts` — namespace rename to `ay_runtime`
- `src/server/runtime/tools/markNodeComplete.ts` — namespace rename to `ay_runtime`; factory takes `{ nodeId, outgoingNodeIds }`; adds optional `next` schema field with adjacency validation
- `src/core/executor.ts` — per-run reachability rewrite (the chunky part of Phase B)
- `src/core/schema.ts` — `WorkflowNode` shape (`kind` → `type`, drones/skills removed, agents/scriptName/args added)
- `src/client/canvas/GameCanvas.tsx` — galaxy-HUD library button + global library overlay
- `src/client/components/ShipDetailsPanel.tsx` — new Tools tab content (calls new endpoints)
- `src/client/views/EditorView.tsx` — type selector, palette, AI form (agents multiselect), script form, drone/skill badges removed
- `src/client/views/RunView.tsx` — drone/skill label render updates if needed

## Changelog vs. initial spec

12-point review applied:

1. **`<ship>` ambiguity** → resolved to `ship.projectPath`, sibling of `.git/`; noted "blowing away repo blows away tools".
2. **Migration contradiction** → wipe & reseed unconditionally; `features.workflow_id` NULL on wipe.
3. **Branching scope** → moved from Phase C to Phase B; honest 3-day add-on inside the executor rewrite. Phase B: 4d → 7d. Phase C: 2d → 1d.
4. **MCP namespace collision** → split into `mcp__ay_runtime__*` (runtime tools) and `mcp__ay_scripts__*` (user scripts).
5. **Agent format compatibility** → adoption is parse-transform-write, not copy. Field map (`mcpServers`→`mcps`) and defaults (`role`/`toolPreset`/`scripts`) spelled out.
6. **`script.sh` execution** → implicit body dropped; `cmd:` is authoritative; non-trivial logic uses `cmd: "bash script.sh ..."` explicitly.
7. **Secrets** → `${env:VAR}` substitution + optional `~/.agentyard/.secrets/secrets.env` autoload. Per-project ecosystem agnostic.
8. **Orphaned SQLite tables** → drop `skills` + `node_skills` in the migration.
9. **`.claude/` catalog scope** → project + user-level sources (matches Claude Code's actual conventions); adoption defaults per-source.
10. **Library freshness** → explicit endpoint, no cache; current `skills.ts` cache pattern dropped.
11. **UI ripple** → Phase B estimate honesty (4d → 7d) + explicit list of touched files.
12. **`mark_node_complete.next` adjacency** → factory takes `{ nodeId, outgoingNodeIds }`; rejects non-adjacent targets.
