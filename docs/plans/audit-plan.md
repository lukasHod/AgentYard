# Workflow Run Observability Audit Plan

Last updated: 2026-06-27

## Goal

Add a Runs observability view to the Feature tab so a user can validate what happened during workflow execution.

The feature must answer:

- Which workflow ran for this feature?
- Which workflow snapshot was used at the time of execution?
- Which nodes ran, failed, skipped, retried, or resumed?
- Which agents were spawned for each node?
- Which skills, scripts, MCPs, tools, permissions, model, and cwd were configured for each agent?
- Which capabilities were actually passed to the runtime?
- Which tools were used?
- When did agents ask questions and when did users answer?
- What interesting runtime moments happened chronologically?

The main user-facing output should be a readable timeline, not a raw terminal transcript.

Example timeline:

```text
10:31:04 Feature "new toggle" workflow started
10:31:04 Workflow snapshot saved: AO Default, hash 7ab2c1
10:31:05 Node "Analyze" started
10:31:05 Spawning agents: planner, reviewer
10:31:07 Leader delegated task to planner
10:31:11 Planner used Read
10:31:14 Planner returned plan draft
10:31:15 Leader delegated task to reviewer
10:31:18 Reviewer used Read
10:31:22 Reviewer found 1 risk
10:31:24 Leader completed Analyze
10:31:24 Node "Implement" started
10:31:25 Spawning agents: developer, tester
10:31:31 Developer used Edit
10:31:35 Developer used Bash
10:31:42 Tester used Read
10:31:44 Tester used Bash
10:31:48 Tester failed check: npm test exited 1
10:31:49 Node "Implement" failed
10:34:10 User retried node "Implement"
10:34:10 Node "Implement" attempt #2 started
```

## Definitions

### Feature

A product/task item owned by a planet. A feature can have many workflow runs.

### Workflow Run

A durable execution record for one full workflow start.

Create a new workflow run when:

- a feature workflow starts for the first time
- the user reruns the entire workflow
- the user manually starts a different workflow for the same feature

Do not create a new workflow run when:

- the app is closed and reopened
- the user clicks continue after a server/app restart
- a terminal session is resumed
- one failed node is retried
- an agent asks a question and later continues

### Node Run

The execution record for one workflow node inside one workflow run.

### Node Attempt

One try at executing a node run.

Retrying a failed node creates a new node attempt inside the same workflow run. It must not create a new workflow run.

Example:

```text
Run #1
  Node: analyze
    Attempt #1 complete
  Node: implement
    Attempt #1 failed
    Attempt #2 complete
  Node: review
    Attempt #1 complete
```

### Resume

Continuing an existing workflow run after app/server/terminal interruption.

Resume should create timeline events such as `workflow_resumed` or `terminal_resumed`, but it should not create a new workflow run.

## User Experience

Add a Runs section inside the Feature tab.

Each feature can show multiple runs, newest first:

```text
Feature "new toggle"
  Run #3 - complete
  Run #2 - failed at Implement
  Run #1 - aborted
```

Each run detail should have two primary tabs.

### Summary Tab

Show a concise recap:

- status: running, complete, failed, aborted
- workflow name
- workflow snapshot hash
- task
- branch and worktree path when available
- duration
- nodes executed
- node status and retry count
- agents spawned
- current blocking state
- final summary or failure reason
- enforcement status

Capability enforcement should be explicit:

```text
developer
Runtime: claude-sdk
Enforcement: verified
Reason: effective SDK tool catalog was captured.

tester
Runtime: claude-code-cli
Enforcement: partial
Reason: CLI terminal runtime captured prompt/cwd/transcript, but hard effective tool allowlist was not verified.
```

### Evidence Tab

Show chronological interesting events.

Features:

- filter by node
- filter by agent
- filter by event type
- filter errors/warnings
- hide prompts by default
- expose prompts only behind a "show prompt" action
- show compact details for tool calls
- show full JSON only in an expandable debug panel

The evidence tab should avoid full transcripts by default. The purpose is to show what happened, not to make the user read every model token.

## Data Model

Add persistent audit tables to the existing database.

### `workflow_runs`

Fields:

- `id`
- `feature_id`
- `planet_id`
- `workflow_id`
- `workflow_name`
- `workflow_snapshot_json`
- `workflow_snapshot_hash`
- `resolved_capability_snapshot_json`
- `task`
- `branch`
- `worktree_path`
- `status`: `running | complete | failed | aborted`
- `started_at`
- `completed_at`
- `final_summary`
- `error`
- `created_at`
- `updated_at`

Notes:

- `workflow_snapshot_json` is immutable.
- It must capture the graph as it existed when the run started.
- The current workflow editor state must not affect old runs.
- `resolved_capability_snapshot_json` should capture resolved agent/tool definitions used during the run.

### `workflow_node_runs`

Fields:

- `id`
- `workflow_run_id`
- `node_id`
- `title`
- `type`
- `custom_type`
- `prompt_hash`
- `status`: `pending | running | complete | skipped | failed`
- `started_at`
- `completed_at`
- `summary`
- `outputs_json`
- `error`
- `created_at`
- `updated_at`

### `workflow_node_attempts`

Fields:

- `id`
- `workflow_run_id`
- `node_run_id`
- `attempt_number`
- `status`: `running | complete | failed | aborted`
- `started_at`
- `completed_at`
- `summary`
- `error`
- `resume_count`
- `created_at`
- `updated_at`

Notes:

- The first execution of a node creates attempt #1.
- Retrying the same node creates attempt #2, #3, and so on.
- Resuming a still-running attempt increments `resume_count` and logs a resume event.

### `workflow_agent_spawns`

Fields:

- `id`
- `workflow_run_id`
- `node_run_id`
- `node_attempt_id`
- `agent_name`
- `role`
- `runtime_kind`: `claude-sdk | claude-code-cli | codex-cli`
- `session_id`
- `terminal_session_id`
- `model`
- `cwd`
- `prompt_hash`
- `skills_json`
- `scripts_json`
- `mcps_json`
- `tool_preset`
- `allowed_tools_json`
- `effective_tools_json`
- `permission_mode`
- `enforcement_status`: `verified | partial | unknown`
- `enforcement_reason`
- `created_at`

Notes:

- Store configured capabilities and effective capabilities separately.
- For SDK mode, effective tools come from `Session.buildSdkOptions()`.
- For CLI mode, mark enforcement as partial until the CLI runtime has a verifiable effective tool allowlist.
- Do not store raw MCP secret values.

### `workflow_audit_events`

Fields:

- `id`
- `workflow_run_id`
- `node_run_id`
- `node_attempt_id`
- `agent_spawn_id`
- `terminal_session_id`
- `event_type`
- `title`
- `summary`
- `details_json`
- `severity`: `info | success | warning | error`
- `created_at`

Event types:

- `workflow_started`
- `workflow_resumed`
- `workflow_completed`
- `workflow_failed`
- `workflow_aborted`
- `node_started`
- `node_completed`
- `node_failed`
- `node_retried`
- `node_skipped`
- `node_resumed`
- `agent_spawned`
- `agent_completed`
- `agent_failed`
- `leader_delegated`
- `tool_used`
- `tool_result`
- `clarification_requested`
- `clarification_answered`
- `user_action`
- `terminal_resumed`
- `artifact_created`

### `workflow_artifacts`

Fields:

- `id`
- `workflow_run_id`
- `node_run_id`
- `node_attempt_id`
- `type`: `file_change | test_output | commit | pr | terminal_reference | diff_summary`
- `label`
- `payload_json`
- `created_at`

Artifacts are optional for this first implementation. The observability feature mainly needs readable runtime events.

## Redaction Rules

Do not persist raw secrets.

Allowed:

- MCP name
- MCP transport type
- MCP command name with arguments redacted when needed
- MCP URL host with token/query redacted
- env var names
- skill names
- script names
- allowed tool names
- effective tool names

Not allowed:

- raw env values
- API keys
- bearer tokens
- full URLs containing secret query params
- raw MCP auth headers

Event examples:

```text
Agent reviewer used chrome MCP
Agent tester used Bash
Agent planner used request_clarification
```

## Runtime Instrumentation

### Workflow Start

When a feature workflow starts:

1. Create feature worktree.
2. Resolve workflow.
3. Save immutable workflow snapshot.
4. Create `workflow_runs` row.
5. Emit `workflow_started`.
6. Start executor with the durable run id.

The current executor mints a `runId` inside `runWorkflowOnSessions()`. Refactor so the caller can provide a run id, or so the audit recorder can receive the generated id before the first event is emitted.

### Node Lifecycle

Use executor events:

- `run:started`
- `node:started`
- `node:complete`
- `node:skipped`
- `run:complete`
- `run:failed`

On `node:started`:

- create or update `workflow_node_runs`
- create `workflow_node_attempts` attempt #1 when needed
- emit `node_started`

On `node:complete`:

- update current attempt
- update node run
- emit `node_completed`

On `node:skipped`:

- update node run status
- emit `node_skipped`

On failure:

- update attempt
- update node run
- update workflow run
- emit `node_failed` and `workflow_failed`

### Node Retry

Add an explicit node retry operation if it does not already exist.

Retry behavior:

1. Find the existing workflow run.
2. Find the node run.
3. Create next node attempt number.
4. Emit `node_retried`.
5. Re-execute the selected node using the original workflow snapshot and current upstream context rules.

Open design detail for implementation:

- If retrying a middle node, decide whether downstream nodes are invalidated and must rerun.
- Recommended initial rule: retrying a node marks downstream nodes as pending/stale and requires continuing from that node forward.

### Resume

Resume behavior:

1. Find running workflow run.
2. Reconcile sessions/terminals.
3. Emit `workflow_resumed`.
4. For each resumed terminal/session, emit `terminal_resumed`.
5. Continue the same workflow run and current node attempt.

No new workflow run should be created.

### SDK Agent Spawns

Instrument SDK mode in `spawnAgentDrone()`.

For each drone:

1. Resolve agent.
2. Resolve skills, scripts, MCPs.
3. Build system prompt.
4. Build SDK options.
5. Store configured capabilities.
6. Store effective tools from SDK options.
7. Store permission mode.
8. Create `workflow_agent_spawns`.
9. Emit `agent_spawned`.

Also store the leader session as an agent spawn with role `leader`.

Leader effective runtime tools:

- `assign_task`
- `mark_node_complete`
- `request_clarification`

### SDK Agent Events

Subscribe to `Session` events:

- `message`
- `tool_use`
- `tool_result`
- `clarification:requested`
- `clarification:resolved`
- `cost`
- `closed`

Map events:

- `assign_task` tool use -> `leader_delegated`
- any other tool use -> `tool_used`
- tool result -> `tool_result`
- clarification requested -> `clarification_requested`
- clarification resolved -> `clarification_answered`
- closed -> `agent_completed` or `agent_failed`

### CLI Terminal Mode

For Claude CLI and Codex CLI:

1. Link terminal sessions to `workflow_run_id`.
2. Link terminal sessions to `node_run_id`.
3. Link terminal sessions to `node_attempt_id` if the schema supports it, or store attempt id in audit events.
4. Store role and runtime.
5. Emit `agent_spawned`.
6. Emit notable terminal lifecycle events.

Initial enforcement status:

```text
partial
```

Reason:

```text
CLI terminal runtime captured prompt, cwd, role, argv, and transcript references, but no verifiable effective tool allowlist was available.
```

Do not claim strict permission enforcement for CLI agents until the runtime can prove it.

## API Plan

Add endpoints:

### `GET /api/features/:featureId/runs`

Returns all workflow runs for a feature, newest first.

Include:

- run id
- status
- workflow name
- workflow hash
- started/completed timestamps
- duration
- final summary/error
- node count
- retry count

### `GET /api/workflow-runs/:runId`

Returns full run recap:

- run metadata
- workflow snapshot metadata
- node runs
- node attempts
- agent spawns
- summary events
- artifacts

Do not include hidden prompts by default.

### `GET /api/workflow-runs/:runId/events`

Paginated chronological event list.

Query params:

- `cursor`
- `limit`
- `nodeId`
- `agentSpawnId`
- `eventType`
- `severity`

### `GET /api/workflow-runs/:runId/prompts`

Privileged/debug endpoint for hidden prompts.

This can be deferred if prompt bodies are not needed in v1.

### Socket Events

Emit live updates:

- `workflow-run:created`
- `workflow-run:updated`
- `workflow-node-run:updated`
- `workflow-node-attempt:updated`
- `workflow-agent-spawned`
- `workflow-audit-event`
- `workflow-artifact:created`

## Client Plan

Add a Runs view inside the Feature tab.

Components:

- `FeatureRunsPanel`
- `RunList`
- `RunDetail`
- `RunSummary`
- `RunEvidenceTimeline`
- `NodeRunTimeline`
- `AgentCapabilityCard`
- `AuditEventRow`
- `PromptDisclosure`

State:

- load runs when feature tab opens
- subscribe to socket updates for selected feature/run
- keep selected run stable when new events arrive
- default to newest run

Summary UI:

- run status badge
- workflow name/hash
- started time and duration
- node progress
- retry count
- resume count
- enforcement warning if any agent is partial/unknown

Evidence UI:

- chronological event log
- compact event rows
- expandable details
- filters
- prompt disclosure hidden by default

## Tests

### Unit Tests

Add tests for:

- feature can have multiple workflow runs
- rerunning whole workflow creates a new run
- retrying one node creates a new node attempt, not a new run
- resuming a run logs resume events, not a new run
- workflow snapshot hash is stable
- workflow snapshot remains unchanged if workflow editor changes later
- capability snapshot includes configured skills/scripts/MCPs/tools
- SDK effective tools are captured from `Session.buildSdkOptions()`
- CLI agents get `enforcement_status = partial`
- redaction removes env values, tokens, auth headers, and secret query params
- prompt text is hidden from default DTOs
- audit event rendering produces readable labels

### Integration Tests

Add tests for:

- starting feature workflow creates `workflow_runs`
- `run:started` creates timeline event
- `node:started` creates node run and attempt #1
- `node:complete` stores summary and emits event
- failed node stores error and event
- SDK agent spawn stores configured and effective capabilities
- leader `assign_task` becomes `leader_delegated`
- SDK `tool_use` becomes `tool_used`
- SDK `clarification:requested` becomes `clarification_requested`
- answering a clarification becomes `clarification_answered`
- terminal sessions are linked to workflow run and node run
- node retry creates attempt #2 in same run
- full workflow rerun creates Run #2

### E2E Tests

Add browser tests for:

- create feature and open Feature tab -> Runs
- Run #1 appears as running
- timeline receives workflow started event
- node started/completed events appear
- agents appear under the correct node
- tools appear in the evidence timeline
- prompts are hidden by default
- clicking show prompt reveals prompt only for that item
- clarification request appears as waiting for user
- answering clarification logs user answer event
- retry failed node shows attempt #2 in same run
- rerun workflow creates Run #2
- CLI run shows partial enforcement warning

## Edge Cases

Handle:

- workflow edited after run start
- missing agent
- missing skill
- missing script
- missing MCP
- agent spawn failure
- leader exits without `mark_node_complete`
- node timeout
- user abort
- server/app restart during running workflow
- terminal runtime lost
- terminal resumed
- multiple runs for one feature
- multiple attempts for one node
- same agent used in multiple nodes
- concurrent runs across features
- large event volume
- malformed event payload
- secret-like values in tool inputs/results

## Verification Checklist

The observability feature is valid when this manual proof works:

1. Create a feature from a planet.
2. Open Feature tab -> Runs.
3. Confirm Run #1 appears with status `running`.
4. Confirm workflow name and snapshot hash are visible.
5. Confirm the node list matches the workflow editor graph used at run start.
6. Confirm each node logs start/completion/failure/skipped events.
7. Confirm each AI node lists exactly the agents attached in the workflow snapshot.
8. Confirm SDK agents show configured skills, scripts, MCPs, allowed tools, effective tools, cwd, model, and permission mode.
9. Confirm CLI agents show partial enforcement warning.
10. Confirm leader delegation appears as timeline events.
11. Confirm tool usage appears as timeline events.
12. Confirm clarification request and user answer appear in order.
13. Fail a node and retry it.
14. Confirm retry creates attempt #2 inside the same run.
15. Rerun the entire workflow.
16. Confirm rerun creates Run #2.
17. Close/reopen the app during a running workflow.
18. Click continue.
19. Confirm the same run continues and logs resume events.
20. Confirm prompts are hidden until explicitly revealed.

## Implementation Order

Recommended sequence:

1. Add audit schema and repository helpers.
2. Add stable workflow snapshot hashing and redaction helpers.
3. Create workflow run at feature workflow start.
4. Persist node lifecycle events.
5. Add node attempts and retry logging.
6. Persist SDK agent spawn capabilities.
7. Persist SDK tool/delegation/clarification events.
8. Link CLI terminal sessions to workflow run/node run and mark enforcement partial.
9. Add feature run APIs.
10. Add socket live updates.
11. Build Feature tab Runs summary.
12. Build Evidence timeline.
13. Add prompt disclosure.
14. Add tests.
15. Run manual verification checklist.

## Open Implementation Questions

These can be decided during implementation:

- Should prompt bodies be stored in the main audit DB or in a separate redacted/debug table?
- Should downstream nodes be automatically marked stale when a middle node is retried?
- Should artifact collection be v1 or v2?
- Should event details store raw SDK payloads after redaction, or only normalized summaries?
- Should there be a retention policy for old runs and event logs?

Recommended defaults:

- Store prompt hashes immediately, prompt bodies behind explicit debug access.
- Mark downstream nodes stale after retrying an upstream node.
- Keep artifact collection minimal in v1.
- Store normalized event details first, raw redacted payload only when useful.
- Do not delete old runs until a retention policy exists.
