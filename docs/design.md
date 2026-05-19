# AgentYard — Agent Orchestrator

## Context

A gamified agent orchestrator for managing the full development workflow across one or many projects. The motivating problem: today, running multiple Claude Code sessions in parallel means cycling through terminal windows, missing prompts, losing track of which agent needs what. AgentYard turns that into a single browser-based "agentyard" where each project is a "ship," features are built by "drone" agents under a "leader," and the user gets game-like notifications when any agent needs input — click the notification, land in that agent's chat panel.

Workflows are visual (node-graph) and editable. The default flow is `analyze → develop → deploy`, but custom prompts, attached skills, and (later) MCP integrations make it reusable across stacks (e.g., a PHP-website workflow vs a TS-library workflow). Built on the Claude Agent SDK so the orchestrator is a true peer to the leader agent, not a passive observer of CLI subprocesses.

## Vision recap

- **Galaxy map** (game canvas) — Space-Rangers-style 2D map; each ship is an animated sprite with its name; hover for status; click to zoom
- **Ship dock view** (game canvas) — single ship in a drydock; when active, drone sprites fly around welding (one drone = one agent)
- **Drone modal** — opens on drone click; status, chat with that agent, definition, connected tools
- **Ship modal** — opens on ship-hull click; status, chat with leader, buttons for Plans / Docs / Descriptions / Workflow / Tool Library
- **HUD overlay** — notification feed ("incoming transmissions"), "New chat" button, "New ship" button, settings/sound
- **Leader + drones per feature** — leader coordinates, drones execute, all observable
- **Notifications** — in-canvas ship pulse + HUD feed + browser notification + sound; click → camera animates to drone modal

## Locked decisions (from brainstorm)

| Decision | Choice |
|---|---|
| App shell | Browser-based, distributed as npm package (`npx agentyard`) |
| Agent runtime | Claude Agent SDK (TypeScript) in-process |
| Spawn model | Hybrid — workflow defines drone slots, leader fills tasking |
| Chat scope | Any agent, anytime (every agent has its own panel + input channel) |
| Tools model | Skills (markdown + scripts) + MCP servers (live integrations) |
| Parallel features | Git worktrees, one per feature on the same ship |
| Persistence | Global SQLite in `~/.agentyard/` (MVP); per-project run data later |
| MVP scope | One ship + editable node graph + skills attached. Defer multi-ship and MCP integration. |
| Provider | Claude-only for v1, abstract behind an interface later |
| Visual editor | React Flow (the canvas library n8n / Flowise / LangFlow all use). n8n-style node UX on top. |
| Execution engine | Small custom DAG executor (~150 LOC) in `src/core/executor.ts`. No LangGraph/n8n fork. Justification: off-the-shelf engines don't model long-lived parallel agents with user barge-in; what's left to write ourselves is small. |
| Repo layout | Single npm package, `src/{server,client,core}`. Vite builds client, tsup builds server, one `package.json`. |
| Project name | `agentyard` |

## Other defaults

- **Default port**: 4242, auto-fallback if taken
- **Skill format**: reuse Claude Code's `name/SKILL.md` + assets convention

## Tech stack

**Server (Node + TypeScript)**
- `@anthropic-ai/claude-agent-sdk` — agent runtime
- `better-sqlite3` — persistence
- `socket.io` (or `ws` + protocol) — bidirectional events to UI
- `simple-git` — worktree management
- `commander` — CLI entry (`agentyard`, `agentyard start`, `agentyard init`)
- `open` — auto-launch browser on start

**Client (React + TypeScript, Vite)**
- `pixi.js` + `@pixi/react` — 2D game canvas for Galaxy map and Ship dock view (animated sprites, particle effects, smooth zoom transitions)
- `@xyflow/react` (React Flow) — node-graph editor for the Workflow screen (custom sci-fi node renderers on top)
- `zustand` or `valtio` — client state
- `tailwindcss` + `shadcn/ui` — UI primitives for themed modals (heavily restyled with sci-fi look — neon borders, glow accents, monospace headers)
- `howler` — sound effects (`incoming transmission` chime, voice barks, ambient hum)
- Browser `Notification` API for background alerts
- `socket.io-client` — server events

**Bundle**: client built to static assets bundled into the npm package; server serves them. Single `npx agentyard` → opens `http://localhost:4242`.

## Data model (SQLite)

```
ships              id, name, project_path, workflow_id, created_at
workflows          id, name, graph_json (nodes + edges + prompts), is_template
skills             id, name, path, description, source ('builtin' | 'user')
mcp_servers        id, name, config_json, enabled  -- v2 use
node_skills        node_id, skill_id              -- attach skills to a node
features           id, ship_id, name, branch, worktree_path, status, created_at
agent_runs         id, feature_id, node_id, role ('leader'|'drone'), skills_json, status
messages           id, agent_run_id, role, content_json, created_at, is_clarification_request
clarifications     id, agent_run_id, tool_use_id, question, answer, status, requested_at
```

Workflow graphs are stored as JSON inside `workflows.graph_json` — simpler than normalized node/edge tables and the editor speaks JSON natively.

## Agent runtime architecture

**The orchestrator is the top-level controller.** It owns:

1. **A `SessionManager`** keyed by `agent_run_id`. Each session wraps a Claude Agent SDK `query()` call with:
   - An **input queue** (async iterable of user messages) — drives the "talk to any agent, anytime" channel
   - An **event stream subscription** — every assistant message, tool call, tool result is persisted and broadcast on Socket.IO
   - A **state machine**: `idle | thinking | tool_running | awaiting_clarification | done | failed`

2. **A custom tool: `request_clarification(question: string)`**, registered with every agent via the SDK's tool API.
   - Handler: creates a `clarifications` row, emits Socket.IO event `clarification:requested` (UI shows toast + sound + browser notification), awaits a promise that resolves when the user replies in the agent's chat panel
   - Returns the user's reply text as the tool result; the agent continues its turn
   - This is the *pull* channel ("agent asks user")

3. **A barge-in channel** — user types in any agent's chat panel → server pushes the message into that agent's input queue → the SDK includes it in the agent's next turn. This is the *push* channel ("user interrupts").

4. **Leader-drone wiring**:
   - When a workflow node is entered, the orchestrator pre-spawns one session per drone slot (skills loaded from `node_skills`) plus the leader session.
   - The leader's system prompt receives the team roster ("you have implementer-1 with skills react,tailwind; tester-1 with skill vitest; …") and the node's `prompt` field as the task.
   - The leader has tools: `assign_task(drone_id, instruction)`, `request_clarification`, `mark_node_complete`.
   - `assign_task` pushes a message into the named drone's input queue. The drone then runs autonomously (and can call `request_clarification` itself).

## Workflow execution

A small DAG executor in `src/core`:

```ts
type Node = {
  id: string
  kind: 'analyze' | 'develop' | 'deploy' | 'custom'
  prompt: string
  skills: SkillRef[]
  drones: DroneSlot[]           // [{role, requiredSkills}]
  inputs: string[]              // names of upstream node outputs to receive
  outputs: string[]             // names of structured outputs this node produces
}

type Edge = { from: string, to: string }
```

Per-feature execution:
1. Topologically sort nodes
2. For each node: spawn leader + drones, hand it inputs from upstream node outputs (stored as JSON blobs in `agent_runs.output_json`), run until leader calls `mark_node_complete(outputs)`, persist outputs, move on
3. Errors / `request_clarification` pause the node, not the rest of the ship

Worktrees are created when a feature starts: `git worktree add .agentyard/worktrees/<feature-id> -b feature/<name>`. The feature's drones operate inside that worktree path. The "deploy" node opens a PR from that branch or runs a deploy hook.

## UI surfaces

AgentYard is presented as a **2D sci-fi game shell** built around two PixiJS canvas views with themed React modals on top. Not a webpage with game theming — a real game whose gameplay is orchestrating agents.

### Game canvas views (PixiJS)

**1. Galaxy map** — top-level view. Space-Rangers-style 2D galaxy where each "star" is a **ship sprite with its name**. User can pan around; ships are spread out enough that hover UI doesn't crowd neighbors. New ships placed automatically (or by user) at unused coordinates.

- **Hover a ship** → tooltip showing:
  - State: `idle | analyzing | developing | deploying | awaiting_clarification`
  - Count of active agents (drones)
  - Count of pending clarifications / unread messages
- **Click a ship** → smooth zoom transition into Dock view.
- **Ambient animation:** ships idle-bob, distant stars parallax, occasional sparkle.
- **Ship visual state** reflects work: glow when active, urgent pulse when clarification pending, "ready to liftoff" effect when deploy is queued.

**2. Ship dock view** — zoomed in on one ship, framed like a vessel in a spacedock (think USS Enterprise in drydock). Single large ship sprite center stage with scaffolding/lights in the environment.

- When work is in progress: **drone sprites** fly around the ship doing visible tasks (welding sparks, scanning beams). **One drone sprite per active agent.** No drones when idle.
- **Click a drone** → opens Drone Modal.
- **Click the ship hull** → opens Ship Modal.
- **Back / Esc** → zoom out to Galaxy.

### Themed modals & screens (React over canvas)

**3. Drone Modal** — appears over the dock view when a drone is clicked.
- Status header: `working on Feature X` / `debugging` / `analyzing` / `awaiting input` …
- Chat window: full transcript with that specific agent, input box (barge-in supported)
- Buttons: `Definition` (role, system prompt, skills), `Connected Tools` (skills + MCP)

**4. Ship Modal** — appears over the dock view when the ship hull is clicked.
- Status header: current phase, summary line ("currently building auth feature", "ready to liftoff")
- Chat window with **the leader agent**
- Buttons: `Plans`, `Docs`, `Descriptions`, `Workflow`, `Tool Library`

**5. Workflow Editor** — full-screen overlay when Workflow button is pressed. React Flow node graph with **sci-fi node renderers and glowing edges** — looks like a tech tree, not a Figma diagram. Add nodes from a palette, attach skills, define drone slots, save.

**6. Plans / Docs / Descriptions / Tool Library** — themed full-screen panels, consistent sci-fi UI aesthetic.

### HUD overlay (persistent over the canvas)

- **Notifications feed** — "incoming transmission" list of pending clarifications across all ships. Click → zooms to the relevant drone and opens its modal.
- **`New chat` button** — opens an ad-hoc Claude chat with no ship attachment, no workflow, no drones. For quick questions, one-off tasks, scratchpad use ("explain this regex", "draft a commit message"). Chat history persisted under a `Free Chats` panel accessible from the HUD.
- **`New ship` button** — opens the New Ship modal (form-driven). On submit, a ship sprite appears in the galaxy and analyze auto-starts.
- **Global mute / settings / sound packs.**

### New Ship modal

Themed form, opens when `New ship` is clicked:
- **Name** (free text — used as ship sprite label)
- **Project path** (existing directory picker or new repo path)
- **Workflow template** (default `analyze → develop → deploy`, or pick saved template)
- **Ticket source** (radio): `Paste text` / `Linear (MCP)` / `Jira (MCP)` / other MCP source
- **Ticket text** (large textarea, populated automatically if MCP source selected)
- **Launch** button → persists ship row, places sprite in galaxy, starts analyze workflow with ticket text as its input

### Notifications

Three layers, fire together:
- **In-canvas pulse** on the ship sprite (visible at any zoom level)
- **HUD feed** entry with sound effect ("incoming transmission" chime + optional voice bark)
- **Browser Notification API** when AgentYard is not focused

Click any of them → camera animates: galaxy → ship → dock → opens that drone's modal.

## Repo / package structure

```
agentyard/
├── package.json         # single package, "bin": "dist/server/cli.js"
├── tsconfig.json
├── vite.config.ts       # client build → dist/public/
├── tsup.config.ts       # server build → dist/server/
├── src/
│   ├── server/
│   │   ├── cli.ts
│   │   ├── server.ts
│   │   ├── db.ts
│   │   └── runtime/
│   │       ├── SessionManager.ts
│   │       └── tools/
│   │           ├── requestClarification.ts
│   │           ├── assignTask.ts
│   │           └── markNodeComplete.ts
│   ├── client/
│   │   ├── main.tsx
│   │   ├── routes/{Galaxy.tsx, ToolLibrary.tsx, Settings.tsx}
│   │   ├── canvas/{GalaxyCanvas.tsx, ShipDockCanvas.tsx, Hud.tsx, sprites/…}
│   │   └── components/{WorkflowEditor.tsx, DroneModal.tsx, ShipModal.tsx, NewShipModal.tsx, AgentChatPanel.tsx, …}
│   └── core/
│       ├── executor.ts  # DAG executor
│       ├── schema.ts    # Zod schemas for Node, Edge, Workflow
│       └── types.ts     # shared types imported by both server and client
```

Client source imports `core` types directly; server source imports `core` and `runtime`. One `package.json`, one set of deps, two build steps.

## Phased implementation plan

**Phase 0 — Scaffolding (1–2 days)**
- Single npm package, TS config, Vite client + tsup server build, Express/Fastify server, Socket.IO wired, `agentyard` CLI runs and opens browser
- SQLite schema migration setup

**Phase 1 — Single-agent loop (3–5 days)**
- Wrap one `@anthropic-ai/claude-agent-sdk` `query()` in a `Session`
- Chat panel UI: send/receive messages, persist transcript
- Implement `request_clarification` tool + clarification UX (toast + sound + browser notification)
- Implement barge-in channel (user types → injected into input queue)

**Phase 2 — Multi-agent (leader + drones) (3–5 days)**
- `SessionManager` for multiple parallel sessions
- `assign_task` and `mark_node_complete` tools
- Hardcoded "develop" node with leader + 2 drones; verify clarifications and chat work across all three

**Phase 3 — Workflow editor + executor (5–7 days)**
- React Flow canvas, node palette, prompt editor, drone-slot editor
- DAG executor walks the graph, manages session spawn/teardown per node
- Default `analyze | develop | deploy` template ships with the app

**Phase 4 — Skills library (3–4 days)**
- Folder-based skill ingestion (drop a folder into `~/.agentyard/skills/` or pick via UI)
- Attach skills to nodes; orchestrator loads them into agent system prompts at spawn time
- Skill library UI (list, attach, detach)

**Phase 5 — Ships + worktrees + features (3–5 days)**
- Functional ship list/create/open (basic React, not yet game canvas)
- Worktree creation per feature; deploy node opens PR via `gh` or pushes to a Vercel hook
- Parallel features on one ship verified end-to-end

> **Engine vs game shell**: Phases 0–5 build the functional engine with a plain React UI so we can validate the agent orchestration end-to-end before investing in art/animation. Phases 6–7 replace the plain UI with the game shell.

**Phase 6 — Game canvas (5–7 days)**
- PixiJS scene setup, asset loader, sprite atlas pipeline
- Galaxy map: pan/zoom, ship-sprite placement, hover tooltips, click-to-zoom
- Ship dock view: single ship framed in dock, drone-sprite system (one drone per active agent, basic flying/welding animation)
- Camera transitions between views
- HUD overlay (notifications feed, new-chat/new-ship buttons)

**Phase 7 — Themed UI + polish (3–5 days)**
- Replace plain React modals with sci-fi-styled Drone Modal, Ship Modal, Workflow Editor, Plans/Docs screens
- Sound design: incoming-transmission chime, ambient hum, voice barks (Howler.js)
- Ship-state visuals: glow when active, pulse when clarification pending, ready-to-liftoff effect
- First-launch flow + empty state

**v2+ (post-MVP)**
- Multi-ship parallelism in UI
- MCP server attachment to nodes (Linear, Jira, GitHub MCP)
- Provider abstraction (Codex, Gemini CLI, local models)
- Live verification step in deploy node (preview URL + smoke checks)
- Workflow template sharing/export
- Role-specific drone sprite art (analyzer/developer/deployer visually distinct)

## Verification (how we know it works)

End-to-end check after Phase 5:
1. `npx agentyard` → browser opens at `localhost:4242`
2. Create a ship pointing at a sample repo (e.g., a small Next.js scaffold)
3. Use the default `analyze | develop | deploy` workflow; paste a feature description into analyze
4. Watch leader spawn drones; drones edit files inside the worktree
5. Trigger a clarification (e.g., set a drone prompt that asks for a design choice) → verify browser notification fires, clicking it focuses that drone's chat, replying continues the run
6. Verify barge-in: type a message into the leader's panel mid-run, confirm the next turn references it
7. Deploy node opens a real PR on a test repo
8. Repeat with two features in parallel on the same ship; verify worktrees don't conflict and both PRs land

Unit/integration:
- DAG executor tests (parallel nodes, sequential, error propagation)
- SessionManager tests (clarification resolution, barge-in ordering)
- Workflow JSON schema round-trip

## Critical files

**Server / runtime (Phases 0–5)**
- `src/server/cli.ts` — CLI entry
- `src/server/server.ts` — HTTP + Socket.IO
- `src/server/db.ts` — SQLite schema + migrations
- `src/server/runtime/SessionManager.ts` — agent lifecycle
- `src/server/runtime/tools/requestClarification.ts` — the key custom tool
- `src/core/executor.ts` — DAG executor
- `src/core/schema.ts` — Zod schemas for Node, Edge, Workflow

**Client — plain UI (Phases 0–5)**
- `src/client/routes/Galaxy.tsx` — galaxy entry (plain list in Phase 5, replaced by canvas in Phase 6)
- `src/client/components/WorkflowEditor.tsx` — React Flow wrapper
- `src/client/components/AgentChatPanel.tsx` — per-agent chat
- `src/client/components/DroneModal.tsx`, `ShipModal.tsx` — modal shells

**Client — game canvas (Phases 6–7)**
- `src/client/canvas/GalaxyCanvas.tsx` — PixiJS galaxy view
- `src/client/canvas/ShipDockCanvas.tsx` — PixiJS dock view
- `src/client/canvas/sprites/ShipSprite.ts` — ship sprite + animation states
- `src/client/canvas/sprites/DroneSprite.ts` — drone sprite + flight/welding animation
- `src/client/canvas/Hud.tsx` — overlay (notifications, action buttons)
- `src/client/canvas/sound.ts` — Howler.js wrapper for sound packs
- `src/client/assets/` — sprite atlas, sound files
