# Tools and Workflow Editor — Design

Spec produced via the `obra/superpowers` brainstorming methodology. All five sections were confirmed section-by-section by the user before writing.

## Context

Today an AgentYard workflow has:
- Fixed node "kinds" (analyze/develop/deploy/custom), styled cosmetically in the editor.
- Per-node `drones: DroneSlot[]` defining the leader's team as anonymous roles.
- Per-node `skills: string[]` attaching skill bodies into every drone's system prompt.
- A global skills library at `~/.agentyard/skills/` shared across all ships.
- No MCP integration in the UI; no scripts; no per-ship tooling; no agent presets.

The user wants the orchestrator to feel like a real shipyard where each ship can be configured with its own toolset, and a workflow editor that supports growth (new node types, branching, custom scripts). This spec replaces the static drone-slot model with a first-class tool library, agent presets, and an extensible node-type system.

Out of scope (logged as follow-ups):
- **Watchers** — scheduled polling triggers that create features (e.g. "every 15 min check GitHub issues, on new issue run analyze→develop→deploy"). Separate sub-project.
- **Loop nodes inside a workflow** — explicitly dropped by the user.
- **Pure rule-based conditional nodes** — branching is handled by AI leaders for now.

## Locked decisions

| Decision | Choice |
|---|---|
| Tool types in v1 | skill, mcp, script, agent (4 total) |
| Storage scopes | `.claude/` (catalog, read-only), `<ship>/.agentyard/` (per-ship, editable), `~/.agentyard/` (global, editable) |
| Lifecycle actions | Adopt (`.claude → per-ship`), Elevate (`per-ship → global`), Fork to ship (`global → per-ship`) |
| Resolution | Per-ship overrides global; `.claude` only visible as catalog |
| Agent role | An agent IS a drone preset. Workflow nodes connect to agents directly; "drone slots" concept is removed. |
| Capability attachment | Skills / MCPs / scripts attach to AGENTS, not to nodes. Connecting an agent to a node brings its full load-out. |
| Node types | Two: `ai` (LLM-driven, leader + agents) and `custom` (deterministic). First custom subtype: `script`. |
| Branching | AI leaders can pass `next?: string[]` in `mark_node_complete` to choose which downstream edges to follow. No dedicated "conditional" node type. |
| Workflow editor | Add/rename/delete nodes via palette; edit edges; replace drone-slots UI with agent multiselect. |
| Migration | Wipe & reseed default workflow + seed default agents (no auto-migrate of existing rows). |

## Conceptual model

```
                ┌───────────────────────────────────────┐
                │              TOOL LIBRARY             │
                │  (per-ship .agentyard/ + global ~/    │
                │  + .claude/ catalog)                  │
                │                                       │
                │  ╭─ skills ─╮  ╭─ mcps ──╮            │
                │  │ react-bp │  │ github  │            │
                │  ╰──────────╯  ╰─────────╯            │
                │                                       │
                │  ╭─ scripts ╮  ╭─ agents ────────╮    │
                │  │ run-tests│  │ developer       │    │
                │  ╰──────────╯  │   skills: [...]  │    │
                │                │   mcps:   [...]  │    │
                │                │   scripts:[...]  │    │
                │                ╰──────────────────╯    │
                └───────────────────────────────────────┘
                                  │
                                  │ (workflow node connects to agents only)
                                  ▼
        ┌──────────────────────────────────────────────────────┐
        │                  WORKFLOW (per ship)                 │
        │                                                      │
        │   [Analyze]──→[Classify]──→[Develop]──→[Deploy]      │
        │   (AI)         (AI)         (AI)        (AI)         │
        │   agents:      agents:       agents:    agents:      │
        │   - planner    - classifier  - dev     - releaser    │
        │   - reviewer                 - reviewer              │
        │                  │                                   │
        │                  └─→[Debug] (AI, agents: [debugger]) │
        │                          │                           │
        │                          └─────────────────→[Deploy] │
        │                                                      │
        │   (Debug routed-to via mark_node_complete.next)      │
        └──────────────────────────────────────────────────────┘
```

## Per-tool schemas

### Skill

`<ship>/.agentyard/skills/<name>/SKILL.md` — existing format, just per-ship:

```
---
name: react-best-practices
description: One-line description
---

# Skill body
Markdown instructions loaded into the drone's system prompt.
```

Catalog source: `<ship>/.claude/skills/<name>/SKILL.md` (same format).

### MCP

One file per server. `<ship>/.agentyard/mcps/<name>.json`:

```json
{
  "name": "github",
  "description": "GitHub MCP — issues, PRs, repos",
  "transport": "stdio",
  "command": "npx",
  "args": ["@modelcontextprotocol/server-github"],
  "env": { "GITHUB_TOKEN": "..." }
}
```

HTTP variant uses `"transport": "http"`, `"url"`, `"headers"`.

Catalog source: `<ship>/.claude/mcp.json` (Claude's single-file format). AgentYard splits each entry as a virtual catalog item; adopting writes out a single-file `.agentyard/mcps/<name>.json`.

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

Plus optional `script.sh` (or `.ps1`, `.py`) for non-trivial logic. When attached to an agent, AgentYard registers an MCP-style custom tool (`mcp__agentyard__<scriptName>`); calling it runs `cmd` (with `{argName}` substitution) via Bash inside the worktree, returns stdout/stderr.

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

Body is the system prompt. Frontmatter uses Claude's existing keys where possible:
- `description`, `model`, `tools`→`allowedTools`, `mcpServers`→`mcps`, `skills`

AgentYard extensions: `role`, `scripts`, `toolPreset`. Existing `.claude/agents/*.md` Just Work once adopted.

### Shadowing

If a tool with the same name exists in both `.claude/` and `.agentyard/`, the `.agentyard/` copy wins (already adopted/edited). The `.claude/` original is hidden from the library to avoid confusion. Same applies between `.agentyard/` per-ship and `~/.agentyard/` global: per-ship wins.

## Library UI

### Two entry points (same component)

1. **Ship cockpit → Tools tab** (primary): shows all three scopes for that ship; all lifecycle actions available.
2. **Galaxy HUD → "library" button** (new): shows global-only library; lets you edit `~/.agentyard/` tools without opening a ship.

### List rendering

Sectioned by type, each tool tagged with its scope and offered relevant actions:

```
TOOLS                                              [+ create new]

▾ SKILLS (4)
   • react-best-practices    [agentyard]  [edit] [delete] [↑ elevate]
   • agentyard-style         [agentyard]  [edit] [delete] [↑ elevate]
   • jira-master             [global]     [edit] [delete] [↓ fork]
   • security-review         [.claude]    [adopt →]

▾ AGENTS (2)
   • developer               [global]     [edit] [delete] [↓ fork]
   • reviewer                [.claude]    [adopt →]

▾ MCPS / SCRIPTS (similar)
```

Action semantics:

| From → To | Action | Effect |
|---|---|---|
| `.claude` → per-ship | Adopt | Copy file into `.agentyard/`; `.claude/` left untouched. |
| per-ship → global | Elevate | Move file from `.agentyard/` to `~/.agentyard/`. Workflow refs (name-only) auto-resolve to global. |
| global → per-ship | Fork to ship | Copy file into `.agentyard/` (per-ship now shadows global). Allows ship-specific divergence. |

### Edit / create form

`[+ create new]` opens a type picker → scope picker (defaults: per-ship if in ship cockpit, global if in galaxy library view) → type-specific form.

| Type | Form fields |
|---|---|
| Skill | name, description, body (markdown textarea) |
| MCP | name, description, transport radio, command+args+env *or* url+headers |
| Script | name, description, cmd, optional `script.sh` body, args schema rows |
| Agent | name, description, role, model dropdown, toolPreset radio, allowedTools multiselect (when claude_code), skills/mcps/scripts multiselects of this ship's library, system prompt textarea (body) |

Save writes to disk. Cancel returns to list. Delete confirms + removes the `.agentyard/` (or `~/.agentyard/`) file. Deleting a per-ship tool that shadows a global one un-shadows the global one (it becomes visible again).

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
  agents?: string[]                  // names; resolver walks per-ship → global

  // type === 'custom'
  customType?: 'script' /* | future */
  scriptName?: string
  args?: Record<string, string>
}
```

`kind` and `drones` and `skills` are gone. Everything previously expressed as a "develop node with drone slots + skills" becomes an "AI node with agents". Each agent self-contains its prompt addition, skills, MCPs, scripts.

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

Two columns:

```
AI                       CUSTOM
  ⊕ AI node                ⊕ Script
                           (future: wait / http / parallel / …)
```

Drag any to canvas → new node of that type. AI nodes have cyan border; script nodes have amber border. Future custom subtypes get their own colors.

### Node lifecycle

- **Add** — drag from palette or click "+ node" → new node at canvas center, opens for editing
- **Rename** — edit `title` in side panel
- **Delete** — button in side panel + confirm, cascades edge cleanup
- **Edit edges** — drag handle → handle adds edge (already works); click edge + Delete key removes (polish needed)

### Runtime — AI node execution

1. Executor resolves each `node.agents[name]`:
   - First try `<ship>/.agentyard/agents/<name>.md`
   - Then `~/.agentyard/agents/<name>.md`
   - Error if neither exists
2. For each resolved agent: spawn drone session with the agent's
   - system prompt (body)
   - skills (loaded via `renderSkillContext`)
   - mcps (registered as MCP servers in the SDK options)
   - scripts (registered as MCP-style custom tools)
   - allowedTools, model, toolPreset (passed through to the SDK)
3. Spawn the leader with `assign_task` (closed over exactly these drones) + `mark_node_complete` + `request_clarification`
4. Leader's system prompt = `node.prompt` rendered with `{task}` and `{upstream_outputs}`
5. Leader does its thing; calling `assign_task("not-in-roster", ...)` returns an error tool_result.

### Runtime — Script node execution

1. Executor resolves `node.scriptName` → script tool (per-ship → global)
2. Render `args` map with `{task}` / `{upstream_outputs}` substitution
3. Render `cmd` with `{argName}` substitution from rendered args
4. Run via Bash inside the worktree (`spawn(...)` with `cwd: worktree.path`)
5. Capture stdout; non-zero exit → node fails with stderr as the error message
6. On success, mark node complete with stdout (truncated if huge) as summary
7. Custom nodes always follow ALL outgoing edges (no branching)

### Branching (AI nodes only)

`mark_node_complete` tool gains an optional `next?: string[]` parameter:

```ts
mark_node_complete({
  summary: string,
  outputs?: Record<string, string>,
  next?: string[]                    // ⟵ NEW
})
```

- Omitted → executor follows all outgoing edges (current behavior; linear chains keep working)
- Specified → executor follows only those listed
- Constraint: each name in `next` must be a direct downstream node id; jumping upstream or to non-adjacent nodes is rejected with an error tool_result (prevents cycles)

The AI leader's system prompt for branching nodes should instruct it on when to pass which `next` (e.g., "if the task mentions 'bug' / 'fix' / 'broken', call mark_node_complete with next=['debug']; otherwise next=['develop']").

## Migration plan

1. **DB**: drop existing `workflows` and `node_skills` rows on next start (early dev, no precious data).
2. **Default workflow reseed**: ship a 4-node default — `Analyze → Develop → Deploy` plus a starter `Classify`-style branching example, all AI nodes with proper agent connections. Skip the seed if the user already has a workflow.
3. **Default agents seed**: write `~/.agentyard/agents/{planner,reviewer,developer,tester,deployer}.md` with sensible default prompts and reasonable toolPreset/allowedTools defaults, so the default workflow's agents resolve out of the box on first run.
4. **Skills**: existing global skills at `~/.agentyard/skills/` stay where they are (their format matches the new schema; just continue to load them as global-scope skills).
5. **Other existing tables**: `ships`, `features`, `messages`, `clarifications` unchanged.

## Phased implementation

Three phases, each independently shippable:

### Phase A — Tool library foundation
- Storage scan: per-ship `.agentyard/{skills,mcps,scripts,agents}/`, global `~/.agentyard/...`, catalog `.claude/...`
- Resolution: per-ship → global → catalog
- Lifecycle actions (Adopt, Elevate, Fork)
- Tool library UI in ship cockpit Tools tab (browse + create + edit + delete + adopt/elevate/fork)
- "Library" button in galaxy HUD opening global-only view
- Forms for all four types

### Phase B — Agent attachment + workflow editor lifecycle
- Schema migration: `kind` → `type`, drones → agents, drop node skills
- Wipe & reseed workflow + agents
- Node side panel: type selector, AI form (prompt + agents multiselect), Script form (script picker + args)
- Palette with drag-to-canvas
- Add / rename / delete nodes
- Edit edges (click + Delete key)
- Runtime: AI node spawn uses agent definitions for drone load-out; leader's roster constrained to node.agents

### Phase C — Custom node runtime + branching
- Script node executor (Bash + arg substitution + stdout capture)
- `mark_node_complete.next` parameter with adjacency validation
- Default workflow includes a branching example
- Editor visual hint when a node has multiple outgoing edges

Estimated effort: A ~5 days, B ~4 days, C ~2 days. Total ~11 days for a focused single developer.

## Verification

End-to-end:
1. `npx agentyard` → open ship cockpit with no `.claude/` or `.agentyard/` directories present → Tools tab shows seeded global agents/skills only
2. Create a per-ship skill → appears with `[agentyard]` badge → connects to an agent via the agent editor → save
3. Create a per-ship agent referencing that skill → connect agent to a workflow node → save
4. Run a feature → drone is spawned with the connected agent's prompt + skill body in its context (verifiable via the chat panel)
5. Adopt a `.claude/` skill into a ship that has one → badge flips, original `.claude/` file unchanged on disk
6. Elevate a per-ship skill → moves to `~/.agentyard/skills/<name>/`; appears in galaxy library; other ships can connect to it
7. Add a script node to a workflow → runs without an LLM, stdout becomes node summary
8. Build a branching workflow (classify → debug | develop → deploy) → run two features, one bug-shaped, one feature-shaped → each follows the correct branch

Unit/integration:
- Resolver tests (per-ship overrides global, .claude shadowed by either)
- Adopt / Elevate / Fork tests (filesystem moves correctly, no stray copies)
- Agent file round-trip (parse → edit → write → parse, no field loss)
- Branching adjacency check (rejecting non-adjacent `next` ids)

## Critical files

New:
- `src/server/tools/scanner.ts` — multi-scope multi-type scanner
- `src/server/tools/resolver.ts` — per-ship → global → error
- `src/server/tools/lifecycle.ts` — adopt / elevate / fork
- `src/server/runtime/agentRuntime.ts` — replaces drone-slot logic in `runWorkflowOnSessions`; materializes agent definitions
- `src/server/runtime/scriptRuntime.ts` — script node executor
- `src/client/views/ToolEditor.tsx` — the tabbed form (skill/mcp/script/agent)
- `src/core/schema.ts` — updated WorkflowNode schema with `type`/`agents`/`scriptName`/`args`

Modified:
- `src/server/skills.ts` — generalize into the new scanner (or replace)
- `src/server/runtime/runWorkflowOnSessions.ts` — switch on `type`, call agent or script runtime
- `src/server/runtime/tools/markNodeComplete.ts` — add `next` parameter
- `src/server/runtime/Session.ts` — accept per-agent skills/mcps/scripts in opts
- `src/client/canvas/GameCanvas.tsx` — galaxy-HUD library button
- `src/client/components/ShipDetailsPanel.tsx` — new Tools tab implementation
- `src/client/views/EditorView.tsx` — palette, side panel changes, type selector
- `src/server/workflows.ts` + `db.ts` — schema migration, reseed
