# AgentYard Backend Runner and Scheduler Plan

## Purpose

AgentYard should support many features across many projects at the same time, while letting each chat or workflow node choose its agent (Claude SDK, Claude Code CLI, Codex CLI, …) and runtime (in-process SDK vs PTY process). This plan captures the backend changes needed to get there, with enough precision to start implementing without re-deciding the shape mid-phase.

Guiding principle: **make AgentYard agent/runtime-agnostic before making it massively parallel.** A scheduler built directly around the current `Session` (Claude Agent SDK) class would be hard to extend to CLI agents later.

## Locked decisions (read before implementing)

| Decision | Choice | Source |
|---|---|---|
| Feature ↔ Run | 1 Feature = 1 active Run + history of past Runs. Worktree owned by the Feature, reused across reruns. | User, 2026-06-13 |
| CLI runtime | `node-pty` for all CLI agents. Single PTY runtime — no plain-pipe path. Prebuilt binaries cover Win (ConPTY) / mac / Linux. | User, 2026-06-13 |
| Persistence shape | Append-only `runner_events` table is the source of truth (replay-able audit log) + denormalized snapshot tables (`runs`, `node_runs`, `runner_sessions`) for fast UI reads. Snapshots are recomputed from events on restart. | Adapted from AO's flat-file `sessions/{id}` + `activity.jsonl` pattern, kept in SQLite to match existing AY persistence. |
| AO-style workflow | Split phase 7 into **7a workflow shape** (default dev workflow nodes, placeholder SCM steps) and **7b GitHub integration** (real PR/CI/review APIs behind an SCM adapter). | User, 2026-06-13 |
| Plugin slot model | Borrow AO's plugin slots — Agent / Runtime / Workspace / SCM / Tracker / Notifier — instead of a single "runner" axis. Lifecycle stays non-pluggable (core). | Validation (AO ARCHITECTURE.md + CLAUDE.md) |
| AO reference | The Agent Orchestrator repo (https://github.com/ComposioHQ/agent-orchestrator) is the reference architecture. A shallow clone lives at `.tmp-ao/` for offline reading — keep it gitignored. | Cloned during plan validation. |

## Product goals

- Run multiple features concurrently across multiple planets/projects.
- Let users choose the agent backend for chats and workflow nodes.
- Support Claude SDK (today), Claude Code CLI, Codex CLI, and future adapters.
- Preserve AgentYard's interactive strengths: barge-in chat, clarification requests, transcripts, visible state, workflow editing.
- Add an AO-style dev workflow as the **default** workflow template — not the only one.
- Build a backend that can later power both the 3D shell and a dense operational dashboard.

## Where this differs from Agent Orchestrator

AO is the closest reference, but AgentYard keeps two things AO doesn't have:

1. **In-process Claude SDK sessions** for structured-tool workflows (request_clarification, assign_task, mark_node_complete). The SDK gives us tool-call observability AO loses by talking to a CLI through a PTY. Keep the SDK adapter as a first-class peer of the CLI adapters — don't remove it.
2. **Visual node-graph workflows** that mix AI nodes and deterministic script nodes. AO's "workflow" is a single canonical lifecycle; AY's is editable per planet.

We adopt AO's plugin slots, lifecycle state machine, activity state machine, and stale-runtime reconciliation. We adapt their flat-file persistence into SQLite (events + snapshots).

## Target backend model

```text
Planet / Project
  Feature                             (1:N — features per planet)
    Worktree                          (1:1 — Feature owns one worktree, reused across runs)
    Runs                              (1:N — only one Run "active" at a time per Feature)
      NodeRuns                        (1:N — one per executed workflow node)
        RunnerSessions                (1:N — leader + drone sessions per node)
          RunnerProcess / SDK handle  (1:1 — the PTY pid + named-pipe path, or the SDK Query)
      PR / CI / Review state          (0:1 per Run — populated by SCM adapter)
```

Invariants:
- A Feature has at most one **active** Run. Starting a new Run on a Feature with an active Run is an error; user must cancel or complete the active Run first.
- A Worktree is created on first Run, lives as long as the Feature does, and is reused on every rerun.
- Every chat/session (planet-chat, feature-chat, leader, drone) records its `agent_kind` + `runtime_kind`, even before multiple kinds are available.

## Phase 0 — Plugin slot interfaces (`packages/core` work)

Before any runtime change, define the interfaces. These mirror AO's plugin slots but stay in the existing single-package layout — no monorepo split yet.

```ts
// src/core/plugins.ts
export type AgentKind = 'claude-sdk' | 'claude-code-cli' | 'codex-cli'
export type RuntimeKind = 'sdk' | 'pty'

export interface AgentCapabilities {
  supports_tools: boolean              // can register MCP tools (only claude-sdk today)
  supports_structured_events: boolean  // emits tool_use / tool_result events, not just text
  supports_clarification_tool: boolean // request_clarification works
  supports_resume: boolean             // can resume a conversation across server restart
  supports_cost: boolean               // reports token cost in events
  supports_mcp: boolean                // can load external MCP servers
  supports_working_directory: boolean  // honors cwd
}

export interface AgentAdapter {
  kind: AgentKind
  runtime: RuntimeKind
  capabilities: AgentCapabilities
  /** Spawn a session — pure function of config, no shared state. */
  start(cfg: AgentStartConfig, ctx: AgentRuntimeContext): Promise<AgentHandle>
}

export interface AgentHandle {
  id: string
  /** Push a user message; non-blocking. Throws if session not running. */
  send(text: string): Promise<void>
  /** Best-effort graceful stop, then SIGKILL after 5s for PTY. */
  stop(): Promise<void>
  /** Cold snapshot of current state (for /api debug endpoints). */
  getStatus(): Promise<AgentSessionStatus>
  /** Stream of normalized events — see AgentEvent below. */
  events: AsyncIterable<AgentEvent>
}

export type AgentEvent =
  | { type: 'assistant_message'; text: string; ts: number }
  | { type: 'user_message_echo'; text: string; ts: number }
  | { type: 'system'; text: string; ts: number }
  | { type: 'tool_use'; tool: string; input: unknown; ts: number }       // only when supports_structured_events
  | { type: 'tool_result'; tool: string; output: unknown; ts: number }   // ditto
  | { type: 'state'; state: AgentLifecycleState; ts: number }
  | { type: 'needs_input'; question: string; toolUseId?: string; ts: number }
  | { type: 'cost'; inputTokens: number; outputTokens: number; ts: number }  // only when supports_cost
  | { type: 'error'; message: string; ts: number }
  | { type: 'exited'; code: number | null; ts: number }
```

`AgentLifecycleState` matches AO's canonical states (see Phase 4).

Why this shape:
- `events` is an `AsyncIterable`, not an `EventEmitter`, so the chat compatibility layer (Phase 3) and the persistence layer (Phase 4) can both consume it without missing events that fire before subscribe.
- Capabilities are on the adapter, not the handle, so UI can disable features at session-creation time.
- `tool_use` / `tool_result` are typed but optional — CLI runners that don't expose them simply never emit them, and the UI hides those panes when `supports_structured_events === false`.

Acceptance for Phase 0:
- [ ] `src/core/plugins.ts` defines the interfaces and an `AgentEvent` zod schema.
- [ ] Existing `Session` and `SessionManager` compile against the new types as a temporary alias — no behavior change yet.
- [ ] No new persistence yet.

## Phase 1 — `claude-sdk` adapter (wrap the existing Session)

Re-shape today's `Session` (`src/server/runtime/Session.ts`) as the `claude-sdk` `AgentAdapter`. No new runtime, no persistence — just rename and re-expose.

Steps:
1. New file `src/server/runtime/adapters/claudeSdk.ts` implements `AgentAdapter`. Its `start()` builds the same SDK options as today's `buildSdkOptions()`, calls `query()`, and returns an `AgentHandle` that:
   - Converts SDK messages to `AgentEvent`s using the existing branching in `handleSdkMessage()`.
   - Translates `request_clarification` tool calls to `needs_input` events.
   - Adapts `Session.ask()` semantics by sending a user message and resolving on the next `state: idle` event.
2. Keep `request_clarification` / `assign_task` / `mark_node_complete` registration where it is today.
3. `SessionManager` becomes a generic `AgentSessionManager` keyed by adapter.kind + handle.id. `featureChat.ts`, `planetChat.ts`, `runWorkflowOnSessions.ts` call into it through the adapter, not directly into `Session`.

Capabilities advertised by `claude-sdk`:
```ts
{ supports_tools: true, supports_structured_events: true, supports_clarification_tool: true,
  supports_resume: false, supports_cost: true, supports_mcp: true, supports_working_directory: true }
```
(Resume comes when we add Phase 4 history replay; SDK doesn't natively resume across process boundaries.)

Acceptance for Phase 1:
- [ ] All existing tests still pass (`npm test`).
- [ ] `Session` class is gone; everything routes through `AgentAdapter`.
- [ ] Chat panels work exactly as today (regression check: planet-chat, feature-chat, workflow runs).
- [ ] DB column `agent_kind` defaults to `'claude-sdk'` on insert (added in migration alongside the rename).

## Phase 2 — PTY runtime + base CLI adapter

Add `node-pty` and build the shared PTY runtime so CLI agent adapters in later phases just plug a launch command in.

Steps:
1. `npm install node-pty` (prebuilt binaries cover Win/mac/Linux on Node 22).
2. New file `src/server/runtime/runtimes/ptyRuntime.ts`:
   - `spawnPty({ argv, cwd, env }): PtyProcess` — creates a ConPTY (Windows) / pseudoterminal (POSIX) using node-pty.
   - Emits `onData(chunk)`, `onExit({ code, signal })`. Buffer caps: 1 MB rolling stdout for catch-up.
   - `write(text)` for stdin.
   - `kill(signal = 'SIGTERM')` → `setTimeout(kill 'SIGKILL', 5000)` if still alive.
   - `resize(cols, rows)` for terminal-attach use cases (Phase 8 dashboard).
3. New abstract `src/server/runtime/adapters/ptyAgentBase.ts`:
   - Implements `AgentAdapter` shell that spawns a PTY via `ptyRuntime`, line-buffers stdout, classifies each line with a `classify(line): AgentEvent | null` hook supplied by the subclass, and emits the events.
   - Handles `stop()` (SIGTERM → SIGKILL).
   - Handles the `exited` event and feeds the lifecycle manager (Phase 4).
4. **No specific CLI adapter in this phase.** Phase 2 ships the runtime + base class with a smoke test that spawns `node -e "console.log('hi')"` and observes the `exited` event.

Acceptance for Phase 2:
- [ ] `node-pty` installed and builds on Win/mac/Linux (CI on all three if available; otherwise documented "tested on Win10").
- [ ] `ptyRuntime.spawnPty` + `ptyAgentBase` covered by unit tests using a stub binary.
- [ ] No regression in existing SDK paths.

## Phase 3 — Chat compatibility layer

Make all chat surfaces (planet-chat, feature-chat, leader, drone, workflow nodes) consume the normalized `AgentEvent` stream — so the frontend never branches on `agent_kind`.

Steps:
1. `TranscriptStore` consumes `AgentEvent`s instead of `SessionEvent`s. Map:
   - `assistant_message`, `user_message_echo`, `system` → `agent:message`
   - `state` → `agent:state`
   - `needs_input` → `clarification:requested` (only when `capabilities.supports_clarification_tool`)
   - `tool_use` / `tool_result` → new socket events `agent:tool_use` / `agent:tool_result` (UI shows them only when capability flag is true)
   - `cost` → new socket event `agent:cost`
   - `error` → `agent:message` (role=system, prefixed `[error]`)
2. `socketHandlers.ts` keeps `agent:send` and `clarification:reply` — they call the adapter's `send()` and the existing clarification resolver respectively.
3. Frontend `AgentChatPanel` reads `session.capabilities` (carried in `SessionDescriptor`) and hides tool panes / cost badges when unsupported.

Acceptance for Phase 3:
- [ ] All current Socket.IO event payloads remain wire-compatible (extended, not changed).
- [ ] Feature-chat regression test still passes against the SDK adapter.
- [ ] `SessionDescriptor` now includes `agentKind` and `capabilities`.

## Phase 4 — Persistent sessions, events, lifecycle

Move important state out of in-memory structures. Adopt AO's lifecycle state machine. Source of truth = `runner_events` (append-only); snapshot tables exist for fast reads and are rebuildable from events.

### Schema additions

```sql
-- A single execution of a feature's workflow.
CREATE TABLE runs (
  id              TEXT PRIMARY KEY,                -- uuid
  feature_id      INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  workflow_id     INTEGER NOT NULL,                -- snapshot of feature.workflow_id at start
  task            TEXT NOT NULL,
  agent_kind      TEXT NOT NULL,                   -- default agent for this run
  state           TEXT NOT NULL,                   -- canonical lifecycle state (see below)
  reason          TEXT,                            -- terminal reason if state is terminal
  final_summary   TEXT,
  error           TEXT,
  cwd             TEXT NOT NULL,                   -- worktree path captured at start
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_runs_feature ON runs(feature_id, created_at DESC);

-- One per workflow node execution.
CREATE TABLE node_runs (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  node_id       TEXT NOT NULL,                     -- workflow node id
  title         TEXT NOT NULL,
  state         TEXT NOT NULL,                     -- pending|running|complete|skipped|failed
  summary       TEXT,
  outputs_json  TEXT,                              -- JSON of structured outputs
  started_at    INTEGER,
  ended_at      INTEGER
);
CREATE INDEX idx_node_runs_run ON node_runs(run_id);

-- One per leader/drone/free session. Maps to AgentHandle.
CREATE TABLE runner_sessions (
  id            TEXT PRIMARY KEY,                  -- handle.id
  run_id        TEXT REFERENCES runs(id) ON DELETE CASCADE, -- null for planet/feature-chat
  node_run_id   TEXT REFERENCES node_runs(id) ON DELETE CASCADE, -- null for non-workflow sessions
  feature_id    INTEGER REFERENCES features(id) ON DELETE CASCADE, -- non-null for feature-chat
  planet_id     INTEGER REFERENCES planets(id) ON DELETE CASCADE,  -- non-null for planet-chat
  agent_kind    TEXT NOT NULL,
  runtime_kind  TEXT NOT NULL,
  role          TEXT NOT NULL,                     -- leader|drone|free
  label         TEXT,
  state         TEXT NOT NULL,                     -- canonical lifecycle
  reason        TEXT,
  pid           INTEGER,                           -- PTY runtime only
  pipe_path     TEXT,                              -- Windows named pipe; null otherwise
  cwd           TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_runner_sessions_run ON runner_sessions(run_id);
CREATE INDEX idx_runner_sessions_feature ON runner_sessions(feature_id);

-- Append-only event log. Source of truth — snapshots above are derivable.
-- New columns are added forward-compatibly; never alter existing payload semantics.
CREATE TABLE runner_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL REFERENCES runner_sessions(id) ON DELETE CASCADE,
  ts             INTEGER NOT NULL,
  type           TEXT NOT NULL,                    -- AgentEvent.type
  payload_json   TEXT NOT NULL                     -- full AgentEvent
);
CREATE INDEX idx_runner_events_session ON runner_events(session_id, id);
```

### Canonical lifecycle states (mirror AO)

States: `not_started`, `working`, `idle`, `needs_input`, `stuck`, `detecting`, `done`, `terminated`.

Terminal reasons: `manually_killed`, `runtime_lost`, `agent_process_exited`, `probe_failure`, `error_in_process`, `auto_cleanup`, `pr_merged`.

### Source-of-truth rules

- Every `AgentEvent` is persisted to `runner_events` **before** anything else reads it. The `AgentHandle.events` stream is fed by a tail-read from the table after insert.
- Snapshot tables are updated in the same transaction as the event insert, but treat snapshots as a cache: a "rebuild snapshots from events" job exists and is part of the boot sequence on detected schema mismatch.
- Activity classification (see AO's `getActivityState`): runtime emits raw events; a small `activity-classifier` derives `state` + `reason` from the last N events plus age. PTY runners get an activity JSONL written under `<cwd>/.agentyard/activity.jsonl` so the classifier has somewhere to look even when no recent events flowed.

### Stale-runtime reconciliation (boot)

On server start:
1. Load every non-terminal `runner_sessions` row.
2. For PTY rows: check `pid` is alive (and matches expected binary on Windows by querying the named-pipe header). If dead → set `state='detecting'`, `reason='runtime_lost'`, append a `state` event, then transition to `terminated` after one probe cycle.
3. For SDK rows: there is no surviving handle (in-process only) → immediately `state='terminated'`, `reason='runtime_lost'`. Persisted transcript still serves the UI; user must reopen the chat to spawn a fresh handle (mirrors today's "interrupted turn notice" in `featureChat.ts`).
4. For each non-terminal Run: if any of its sessions terminated with `runtime_lost`, the Run goes to `stuck` and the lifecycle manager surfaces a "resume or cancel" action in the dashboard.

Acceptance for Phase 4:
- [ ] All schema migrations land in `db.ts` with the `runAdd*Migration` pattern.
- [ ] `runner_events` write happens in the same transaction as snapshot updates.
- [ ] Boot reconciliation marks dead sessions terminated and surfaces stuck runs.
- [ ] `transcriptStore` reconstructs catch-up payloads from `runner_events`, not in-memory buffers.
- [ ] Feature chat survives full server restart: history replays, but a fresh send spawns a fresh handle.

## Phase 5 — `claude-code-cli` and `codex-cli` adapters

Concrete agent adapters on top of `ptyAgentBase` (Phase 2). Each one supplies:
- `getLaunchCommand(cfg): string[]` — argv for node-pty.
- `getEnv(cfg): Record<string, string>` — env merged with process.env.
- `classify(line: string): AgentEvent | null` — line-by-line classifier.
- Optional `recordActivity` writer (AO-style) into `<cwd>/.agentyard/activity.jsonl`.

### `claude-code-cli` adapter

- Launch: `claude --print --output-format stream-json` for one-shot, `claude` for interactive. Default to interactive.
- Classifier reads stream-json events (assistant message, tool_use, tool_result, result) when stream-json is on, falls back to regex for prompt-detection when off.
- Capabilities: `{ supports_tools: true (via Claude Code's own tool registry, not MCP we register),
  supports_structured_events: true (stream-json mode only),
  supports_clarification_tool: false (no MCP injection),
  supports_resume: true (uses `claude --continue`),
  supports_cost: true (stream-json reports it),
  supports_mcp: true (Claude Code loads its own MCPs from settings),
  supports_working_directory: true }`

### `codex-cli` adapter

- Launch: `codex exec --json` (research the actual flag set when implementing — AO has a working version in `packages/plugins/agent-codex/` to copy patterns from).
- Capabilities: similar to claude-code-cli, but `supports_clarification_tool: false`, `supports_resume: depends on codex's `--continue` equivalent`.

### Test plan
- Smoke test per adapter: launch with `--version` or equivalent, observe `exited` event with code 0.
- Integration test: launch in an empty temp dir, send "create a file called hello.txt with content 'hi'", verify the file exists after the run.

Acceptance for Phase 5:
- [ ] Both adapters registered in `AgentAdapterRegistry`.
- [ ] User can pick agent kind from a dropdown in the Drone Modal and the chat works.
- [ ] Activity JSONL written for both adapters.

## Phase 6 — Runner selection UI + per-feature runner choice

Add agent-kind selection at every level:

| Surface | Default source | Override |
|---|---|---|
| Free chat | Global default | Per-chat dropdown |
| Planet chat | Planet default | Per-chat dropdown |
| Feature chat | Feature default → Planet default → Global | Per-feature setting |
| Workflow leader | Node setting → Run-level default → Feature default | Per-workflow-node setting |
| Workflow drone | Agent definition (tool library) → leader's choice | Per-drone setting in agent definition |

Schema additions:
- `planets.default_agent_kind` (TEXT, default `'claude-sdk'`)
- `features.default_agent_kind` (TEXT, nullable — null = inherit from planet)
- `workflows.graph_json` — node objects gain optional `agent_kind` field.
- Global default lives in `~/.agentyard/config.json` next to `agentyard.db`.

UI:
- New `<AgentKindPicker>` component reused across planet settings, feature settings, workflow node editor, and chat header.
- Picker disables options whose capabilities don't fit the surface (e.g. feature-chat requires `supports_working_directory`).

Acceptance for Phase 6:
- [ ] All migrations land. Existing rows default to `claude-sdk` so behavior is unchanged.
- [ ] Each surface honors the cascade.
- [ ] Mixed-agent workflows verified: leader on `claude-sdk`, drone on `claude-code-cli`, in one run.

## Phase 7 — Multi-Run registry + scheduler

Replace the single-slot `RunRegistry` with a per-feature registry under a single global scheduler.

### Concurrency model

- Per-feature: at most 1 active Run (enforced by `runs.state` not in {`done`,`terminated`} ∧ unique feature_id).
- Per-planet: configurable `maxConcurrentRuns` (default 3). Excess Runs go to `not_started` and wait.
- Global: configurable `maxConcurrentRuns` (default 10). Same waiting behavior.

### Scheduler semantics

- **Queued, not rejected**: hitting a limit puts the Run in `not_started`. The scheduler polls (every 2s) and admits the oldest waiting Run when capacity frees up.
- **Cancellation**: `runs/:id/cancel` aborts the run's signal. The runtime adapters' `stop()` is called for every live session. Run transitions to `terminated`, reason `manually_killed`.
- **Retry from failed node**: lifecycle exposes "retry from node X" which creates a new Run with `task`, `workflow_id`, and pre-seeded `node_runs` summaries for nodes before X. Implemented in Phase 7b only after SCM integration; this phase just adds the API stub.

Acceptance for Phase 7:
- [ ] `RunRegistry` deleted; replaced by `RunScheduler` keyed by run_id.
- [ ] Concurrency limits enforced at planet + global scope.
- [ ] Cancellation tested under load (10 runs, cancel mid-flight, all sessions cleaned up).
- [ ] Active-run snapshot still drives the Socket.IO `run:snapshot` catch-up payload (now per-run, not single).

## Phase 8a — AO-style default workflow shape

Add the workflow template, with **placeholder** SCM steps so the workflow can be edited and executed end-to-end against a local repo before any GitHub plumbing exists.

Nodes:
```
Intake / Analyze         (AI — planner + reviewer agents, as today)
  → Create branch        (custom/script — runs `git checkout -b feature/<slug>` in the worktree)
  → Implement            (AI — developer + tester agents, as today)
  → Self-review          (AI — reviewer agent)
  → Run tests            (custom/script — runs `npm test` or planet-configured test cmd)
  → Commit               (custom/script — `git add -A && git commit -m '<msg>'`)
  → Open PR              (custom/script — placeholder: writes `PR-PENDING.md` with the diff; Phase 8b replaces with real PR creation)
  → Watch CI             (custom/script — placeholder: sleeps + writes `CI-OK.md`)
  → Watch review         (placeholder)
  → Mark ready to merge  (custom/script — emits a `ready_to_merge` lifecycle reason)
```

The placeholders are real custom-script nodes; they just don't call GitHub. This lets us:
1. Validate the new node graph schema with placeholder commands.
2. Use the workflow against `https://github.com/your-org/test-repo.git` and watch full end-to-end execution.
3. Swap placeholders for real SCM adapter calls in 8b without changing the graph shape.

Acceptance for Phase 8a:
- [ ] Default workflow is the new graph for newly created Features.
- [ ] Existing Features keep their workflow (no in-place migration; per-feature override unchanged).
- [ ] Placeholder steps verified end-to-end on a sample repo.

## Phase 8b — GitHub SCM/Tracker integration

Replace placeholder SCM steps with a real SCM adapter behind a slot interface (mirrors AO's `scm-github` plugin).

```ts
export interface ScmAdapter {
  createPr(cfg: { repo: string; branch: string; base: string; title: string; body: string }): Promise<{ number: number; url: string }>
  getPr(cfg: { repo: string; number: number }): Promise<PrState>
  pollChecks(cfg: { repo: string; sha: string }): Promise<CheckRunsState>
  listReviewComments(cfg: { repo: string; number: number }): Promise<ReviewComment[]>
  isMergeable(cfg: { repo: string; number: number }): Promise<boolean>
}

export interface TrackerAdapter { /* GitHub issues today; Linear later */ }
```

Implementation:
- Use `gh` CLI under the hood (same approach as AO) so we inherit the user's auth flow.
- All calls go through the adapter; the workflow nodes only ever speak adapter API.
- Polling cadence: 30s for CI, 60s for review comments. Configurable in `~/.agentyard/config.json`.
- PR state surfaces in the Run's snapshot and drives lifecycle transitions:
  - `working` → `pr_open` when PR is opened
  - `pr_open` → `ci_failed` / `review_pending`
  - `review_pending` → `changes_requested` / `approved`
  - `approved` → `mergeable` → `merged` → `done`

Acceptance for Phase 8b:
- [ ] `gh` is detected at server start; missing → workflow node fails fast with actionable error.
- [ ] Real PR opened on a sample repo end-to-end, CI watched, comments fetched.
- [ ] PR state cached in `runs.outputs_json` (or a new `runs.pr_state_json` column — pick at impl time).

## Phase 9 — Operational dashboard

Render the snapshot tables as a kanban-style view alongside the 3D shell. Columns mirror AO's dashboard:

```
Working | Needs Input | Failed / Stuck | In Review | CI Failing | Ready to Merge | Done
```

Each card shows: Feature name, Project, Agent kind, Current node, Branch, PR #, Last activity (driven by activity JSONL), Status badge, Quick actions (open chat, stop, retry, attach PTY, open PR).

The 3D shell stays the ambient identity layer; the dashboard is the command surface for high-volume work. Tab between them.

Acceptance for Phase 9:
- [ ] All seven columns render and refresh via Socket.IO snapshot events.
- [ ] Stop / retry / open PR actions wired to the relevant API.
- [ ] PTY attach: dashboard can open a read-only xterm.js view of a live PTY session's rolling buffer (write later if needed).

## Recommended build order (precise)

| # | Phase | Output |
|---|---|---|
| 1 | Phase 0 | Plugin slot interfaces in `src/core/plugins.ts` |
| 2 | Phase 1 | `claude-sdk` adapter wrapping today's `Session`; `agent_kind` column added |
| 3 | Phase 4 (schema only) | `runs`, `node_runs`, `runner_sessions`, `runner_events` tables; no behavior change yet |
| 4 | Phase 4 (writes) | All SDK paths persist events; snapshots updated |
| 5 | Phase 4 (boot) | Stale-runtime reconciliation; transcript catch-up from events |
| 6 | Phase 2 | `ptyRuntime` + `ptyAgentBase` + smoke test |
| 7 | Phase 5 | `claude-code-cli` adapter |
| 8 | Phase 5 | `codex-cli` adapter |
| 9 | Phase 3 | Frontend normalization (Socket.IO + UI) |
| 10 | Phase 6 | Agent-kind selection UI + cascade |
| 11 | Phase 7 | Multi-run scheduler |
| 12 | Phase 8a | AO-style default workflow with placeholders |
| 13 | Phase 8b | GitHub SCM/Tracker adapter |
| 14 | Phase 9 | Operational dashboard |

## Near-term non-goals

- Do not migrate the frontend stack to match AO or any other orchestrator.
- Do not split into a monorepo until plugin boundaries prove they need package-level separation. Slot interfaces in one package is fine.
- Do not build the scheduler before the runner abstraction exists.
- Do not remove the Claude SDK path; it's still required for tools the CLI runners can't model (assign_task, mark_node_complete, request_clarification with MCP).
- Do not make the AO-style lifecycle the only workflow. It is the default; users edit it freely.
- Do not adopt AO's flat-file persistence — AY's SQLite is fine and gives us transactional event/snapshot writes.

## Open questions to resolve before Phase 5

These are deferred but should be answered when starting the relevant phase:

1. **Codex CLI flag set**: confirm the exact one-shot/interactive flags and stream output format. AO's `packages/plugins/agent-codex/` is the reference; read it when implementing.
2. **PTY attach UX**: read-only buffer vs full interactive xterm.js in the dashboard. Decide before Phase 9.
3. **Cost rollup**: per-session vs per-run cost surface. Decide before Phase 9.
4. **PR state column shape**: dedicated `runs.pr_state_json` vs reuse of generic `outputs_json`. Decide before 8b.

## Reference

- Agent Orchestrator (ComposioHQ): https://github.com/ComposioHQ/agent-orchestrator
  - Cloned to `.tmp-ao/` for offline reference. Particularly useful:
    - `packages/core/src/types.ts` — plugin slot interfaces
    - `packages/core/src/lifecycle-manager.ts` — canonical state machine + polling
    - `packages/core/src/lifecycle-state.ts` — canonical → legacy status mapping
    - `packages/plugins/runtime-process/` — Windows ConPTY + named-pipe pattern
    - `packages/plugins/agent-claude-code/` — JSONL activity classification
    - `packages/plugins/scm-github/` — `gh`-CLI-backed SCM adapter
  - **Add `.tmp-ao/` to `.gitignore` before committing this plan.**
