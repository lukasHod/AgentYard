# Terminal-Based Chats Implementation Plan

## Goal

Make AgentYard a terminal-first multi-agent command center.

Users should be able to start many features across many planets, run Claude or Codex inside AgentYard, follow custom workflows, receive global notifications, resume work after restart, and always know which planet, feature, node, or agent needs attention.

## Core Principles

AgentYard owns workflow state.

Terminals execute work.

Every terminal belongs to a durable session.

Every session belongs to a feature.

Every feature belongs to a planet.

Every waiting state bubbles upward.

```text
Agent waiting
  -> Feature waiting
  -> Planet waiting
  -> Global HUD notification
```

## Target Model

```text
Planet
  Feature
    Workflow Run
      Workflow Node
        Agent Session
          Terminal Session
          Transcript
          State
          Pending Questions
```

## Main Technical Decision

Use a hybrid model.

```text
AgentYard workflow engine = source of truth
Claude/Codex terminal sessions = execution layer
Structured events = routing, notifications, persistence, workflow progress
```

Raw terminal text must not be the only source of state.

Chat UI should no longer be the primary execution surface.

AgentYard should use terminal tabs with structured metadata around them.

## Phase 1: Durable Feature And Session Model

Goal: every feature can survive navigation, reload, and PC shutdown.

Add or formalize these records.

```ts
type Planet = {
  id: number
  projectPath: string
  status: PlanetStatus
  waitingCount: number
}

type Feature = {
  id: number
  planetId: number
  name: string
  task: string
  branch: string
  worktreePath: string
  workflowId: number
  workflowRunId: string
  state: FeatureState
  waitingCount: number
  defaultAgentKind: AgentKind
}

type WorkflowRun = {
  id: string
  featureId: number
  workflowId: number
  currentNodeId: string | null
  state: WorkflowRunState
}

type WorkflowNodeRun = {
  id: string
  workflowRunId: string
  nodeId: string
  state: NodeRunState
  waitingCount: number
}

type AgentSession = {
  id: string
  planetId: number
  featureId: number
  workflowRunId: string
  nodeRunId: string | null
  role: string
  agentKind: 'claude-sdk' | 'claude-code-cli' | 'codex-cli'
  runtimeKind: 'sdk' | 'pty'
  cwd: string
  argv: string[]
  state: AgentState
  waitingCount: number
  resumeRef?: string
  lastStartedAt?: number
  lastExitedAt?: number
}
```

Technical solution:

- Store these records in SQLite.
- Treat session IDs as durable identities.
- Treat PTY process IDs as temporary runtime attachments.
- Keep worktree path and branch on the feature.
- Store agent kind per session.
- Avoid global provider assumptions.

## Phase 2: Terminal Runtime As First-Class Backend

Goal: replace chat panes with real terminal sessions.

Use the existing PTY runtime as the base.

Add a `TerminalSessionManager`.

Responsibilities:

- Spawn PTY processes.
- Attach UI clients.
- Stream output.
- Accept input.
- Resize terminal.
- Kill process.
- Restart session.
- Store transcript chunks.
- Expose session status.
- Restore metadata after server restart.

Socket.IO protocol:

```ts
terminal:attach
terminal:detach
terminal:start
terminal:input
terminal:data
terminal:resize
terminal:kill
terminal:restart
terminal:snapshot
terminal:exit
```

Technical solution:

- Use `@lydell/node-pty`.
- Use ConPTY on Windows.
- Use shell PTY on Unix.
- Use `taskkill /T /F /PID` on Windows for process tree cleanup.
- Use `SIGTERM`, then `SIGKILL`, on Unix.
- Store rolling buffers in memory.
- Persist transcript chunks in SQLite in batches.

## Phase 3: Terminal Profiles

Goal: free chats, leaders, and workers can run Claude CLI, Codex CLI, SDK, or a plain shell.

Define terminal profiles.

```ts
type TerminalProfile = {
  id: string
  name: string
  agentKind: AgentKind
  runtimeKind: 'sdk' | 'pty'
  argvTemplate: string[]
  env?: Record<string, string>
  defaultShell?: boolean
}
```

Examples:

```text
Claude CLI
  argv: ["claude"]

Codex CLI
  argv: ["codex"]

PowerShell
  argv: ["powershell.exe"]

Unix Shell
  argv: [$SHELL]

Custom
  argv: user-defined
```

Technical solution:

- Add global default profile.
- Add planet default profile.
- Add workflow default profile.
- Add workflow node default profile.
- Add per-feature override.
- Add per-agent-slot override.

Priority order:

```text
agent slot override
feature override
workflow node default
workflow default
planet default
global default
```

## Phase 4: Terminal UI Replacement

Goal: every old chat surface becomes a terminal tab.

Add `TerminalPanel`.

Features:

- Render with xterm.js.
- Attach on mount.
- Send keyboard input.
- Stream PTY output.
- Resize with container.
- Reconnect after navigation.
- Show scrollback snapshot.
- Show cwd, branch, agent kind, and role.
- Show killed, exited, and restart states.
- Support copy, paste, clear, Ctrl+C, Esc, and Tab.

Use:

- `xterm`
- `@xterm/addon-fit`
- `@xterm/addon-web-links`
- Optional `@xterm/addon-search`

Replace:

- Free chat body.
- Feature leader chat.
- Drone or worker chat.
- Test run agent chat.
- Workflow run chat.

Keep the same visual shell:

- Same panels.
- Same HUD.
- Same modals.
- Same planet and feature structure.

Only the interaction body changes from chat messages to terminal.

## Phase 5: Feature Workspace UI

Goal: every feature becomes a focused workspace.

Feature view layout:

```text
Feature Header
  status
  branch
  worktree
  workflow node
  waiting badges

Tabs
  Leader
  Analyzer 1
  Analyzer 2
  Backend Dev
  Frontend Dev
  Reviewer
  Shell
  Logs

Main Panel
  selected terminal

Right Rail
  pending questions
  workflow progress
  changed files
  PR/CI state
```

Technical solution:

- Render agent sessions as tabs.
- Show state badges on tabs.
- Show orange glow for waiting tabs.
- Show gray for exited tabs.
- Show red for failed tabs.
- Show blue or green for running tabs.
- Attach terminal when tab is selected.
- Keep hidden backend sessions alive.

## Phase 6: Workflow Engine Owns State

Goal: workflows remain reliable with terminal agents.

AgentYard owns:

- Current workflow node.
- Spawned agents.
- Node completion policy.
- Review loop state.
- Clarification state.
- Retries.
- Handoff state.
- Next-node transition.

Workflow example:

```text
Analyze
  agents: product-analyzer, technical-analyzer
  completion: all agents ready + no pending questions

Implement
  agents: backend-dev, frontend-dev
  then: backend-reviewer, frontend-reviewer, architect-reviewer
  completion: all reviewers approve + tests pass

Shift
  agents: release-agent
  completion: PR created + checks green
```

Technical solution:

- Keep the DAG executor.
- Add node run state.
- Add agent slot state.
- Add explicit completion policies.
- Add review loop policies.
- Add max loop count.
- Add manual override.

## Phase 7: AgentYard Bridge For Terminal Agents

Goal: terminal CLIs can report structured events back to AgentYard.

Terminal output alone is not reliable enough.

Add an AgentYard local bridge.

Start with local CLI commands.

```bash
agentyard ask-user --session <id> "Question?"
agentyard mark-ready --session <id> --artifact analysis.md
agentyard submit-review --session <id> --status changes-requested --file review.md
agentyard approve --session <id>
agentyard mark-node-complete --node-run <id>
agentyard spawn-agent --slot backend-dev
```

Technical solution:

- Inject session context into terminal environment.

```bash
AGENTYARD_SESSION_ID
AGENTYARD_FEATURE_ID
AGENTYARD_NODE_RUN_ID
AGENTYARD_WORKFLOW_RUN_ID
AGENTYARD_BRIDGE_URL
```

- Add bridge endpoints on the server.
- Validate session ownership.
- Convert bridge calls into structured events.
- Store events in SQLite.
- Broadcast events to UI.

Later:

- Expose the same bridge as MCP.
- Let Claude CLI and Codex call AgentYard tools more naturally.

## Phase 8: Clarification Routing

Goal: users never hunt for the correct terminal.

When any agent asks for input:

```text
agent creates pending question
AgentYard stores it
agent session becomes needs_input
node run waitingCount increments
feature waitingCount increments
planet waitingCount increments
HUD shows notification
```

Question record:

```ts
type PendingQuestion = {
  id: string
  planetId: number
  featureId: number
  workflowRunId: string
  nodeRunId: string | null
  agentSessionId: string
  question: string
  state: 'pending' | 'answered' | 'dismissed'
  createdAt: number
  answeredAt?: number
  answer?: string
}
```

Answer options:

- Answer from HUD.
- Answer from feature side rail.
- Answer inside leader view.
- Answer directly in agent terminal tab.

Technical solution:

- Central answer UI sends answer to backend.
- Backend routes answer to the correct terminal session.
- If PTY is alive, write answer to stdin.
- If PTY is dead, store answer and require continue or restart.
- Mark question answered.
- Recompute waiting counts.

## Phase 9: Global Notification Router

Goal: clicking a HUD notification navigates to the exact agent tab.

Notification target:

```ts
type NotificationTarget = {
  planetId: number
  featureId: number
  workflowRunId: string
  nodeRunId?: string
  agentSessionId?: string
  questionId?: string
  focus: 'terminal' | 'question' | 'feature' | 'workflow'
}
```

Click behavior:

```text
open planet
open feature
open workflow run
select node
select agent tab
attach terminal
focus terminal or question input
```

Technical solution:

- Store notifications durably.
- Broadcast notifications through Socket.IO.
- Keep HUD independent from the current planet.
- Use a central navigation action in Zustand.
- Resolve missing or dead sessions gracefully.
- Show Continue Session when the process is gone.

## Phase 10: Waiting State Propagation

Goal: orange glow appears at every correct level.

State aggregation:

```text
AgentSession.waitingCount = pending questions for session
NodeRun.waitingCount = sum child sessions
Feature.waitingCount = sum node runs + feature-level blockers
Planet.waitingCount = sum features
Global.waitingCount = sum planets
```

Visual rules:

```text
agent tab has pending question -> orange dot/glow
feature has waiting agent -> orange feature glow
planet has waiting feature -> orange planet glow
HUD has global notification
```

Technical solution:

- Recompute counts on every structured event.
- Persist pending records as the source of truth.
- Cache counts for UI speed.
- Broadcast compact state updates.

Example event:

```ts
{
  type: 'waiting-counts:update',
  planetId,
  featureId,
  nodeRunId,
  agentSessionId,
  counts: {
    planet: 2,
    feature: 1,
    node: 1,
    agent: 1
  }
}
```

## Phase 11: Resume And Continue After Shutdown

Goal: PC shutdown does not destroy feature context.

Reality:

- PTY processes die on shutdown.
- Session identity must survive.
- Worktree and transcript survive.
- Exact resume depends on CLI support.

Session states after restart:

```text
alive
terminated
runtime_lost
resumable
restartable
needs_manual_recovery
```

Continue options:

- Attach if still alive.
- Resume if the CLI supports resume.
- Restart with context if exact resume is unavailable.
- Open plain shell in the worktree.
- Hand off to another agent kind.

Technical solution:

- Reconcile sessions on server boot.
- Mark missing PTY processes as `runtime_lost`.
- Keep feature state.
- Keep terminal transcript.
- Generate handoff summary.
- Show Continue button.

Restart prompt includes:

- Original task.
- Workflow node.
- Role.
- Skills.
- Branch.
- Changed files.
- Recent commits.
- Pending questions.
- Last transcript summary.
- Current PR/CI state.

## Phase 12: Multi-Provider Per Feature

Goal: Feature A can use Claude CLI and Feature B can use Codex CLI on the same project.

Technical solution:

- Each feature gets its own worktree.
- Each agent session stores its own `agentKind`.
- Adapter registry starts the correct runtime.
- No global provider assumption.

Example:

```text
Project A
  Feature 1
    worktree: .agentyard/worktrees/1
    leader: claude-code-cli
    workers: claude-code-cli

  Feature 2
    worktree: .agentyard/worktrees/2
    leader: codex-cli
    workers: codex-cli
```

This works because:

- Branches are isolated.
- CWD is isolated.
- Terminal sessions are isolated.
- Transcripts are isolated.
- Workflow runs are isolated.

## Phase 13: Review And Implementation Loops

Goal: workflows can repeat developer/reviewer cycles until approved.

Node policy example:

```ts
type ReviewLoopPolicy = {
  developerSlots: string[]
  reviewerSlots: string[]
  approvalRequiredFrom: string[]
  maxIterations: number
  requireTestsPassing: boolean
}
```

Flow:

```text
spawn developers
developers implement
spawn reviewers
reviewers submit findings
if findings exist:
  send findings to developers
  developers fix
  reviewers run again
if all approve:
  node complete
```

Technical solution:

- Store review artifacts.
- Store approval state per reviewer.
- Store iteration count.
- Route reviewer findings to developer terminals.
- Let leader see summary.
- Stop loop on approval, max iterations, or manual intervention.

## Phase 14: Git, PR, And CI Watchers

Goal: AgentYard helps without constant manual checking.

Watch:

- File changes.
- Branch status.
- Commits.
- PR created.
- CI status.
- Review comments.
- Mergeability.
- Conflicts.

Technical solution:

- Use local git polling first.
- Use GitHub CLI/API for PR and CI.
- Attach watcher state to feature.
- Convert watcher events into notifications and workflow events.

Examples:

- CI failed -> notify feature and route logs to responsible agent.
- Review requested changes -> route comments to reviewer/developer loop.
- PR green -> mark Shift node ready.
- Merge conflict -> mark feature blocked.

## Phase 15: Free Chats

Goal: normal chats also become durable terminal sessions.

Free chat model:

```text
Free Chat
  session id
  agent kind
  cwd optional
  transcript
  resume metadata
```

Default:

- Start Claude CLI terminal.
- Allow Codex CLI or SDK override.
- Allow plain shell mode.

Technical solution:

- Free chats use the same `AgentSession` and `TerminalSession` model.
- Free chats have no feature ID.
- Free chats still appear in the global session list.
- Free chats can later be attached to a feature if needed.

## Phase 16: UI State And Navigation

Goal: movement across planets, features, nodes, and tabs is reliable.

Frontend state:

```ts
type UiNavigationState = {
  selectedPlanetId?: number
  selectedFeatureId?: number
  selectedWorkflowRunId?: string
  selectedNodeRunId?: string
  selectedAgentSessionId?: string
  focusedQuestionId?: string
}
```

Technical solution:

- Use one central navigation store.
- Notification clicks update this state.
- Panels react to this state.
- Terminal attaches after selected agent changes.
- Missing targets show recovery state.

## Phase 17: Cross-Platform Support

Goal: same AgentYard behavior on Windows, macOS, and Linux.

Windows:

- Use ConPTY through `@lydell/node-pty`.
- Default shell is PowerShell.
- Resolve binaries for `claude`, `codex`, `git`, and `gh`.
- Kill process trees with `taskkill`.
- Handle CRLF carefully.
- Store paths normalized.
- Display paths in native format.

Unix:

- Use PTY.
- Default shell is `$SHELL`.
- Kill process group.
- Support bash, zsh, and fish.
- Add optional tmux support later.

Shared:

- Never assume shell syntax in core logic.
- Launch commands with argv arrays.
- Store cwd per session.
- Escape only at profile-rendering boundaries.

## Phase 18: Minimal Build Order

1. Add durable session tables.
2. Add terminal socket protocol.
3. Build `TerminalSessionManager`.
4. Add xterm `TerminalPanel`.
5. Replace free chat with terminal session.
6. Replace feature leader chat with terminal session.
7. Add agent tabs inside feature view.
8. Add pending question records.
9. Add waiting-count propagation.
10. Add global HUD notification routing.
11. Add workflow-agent spawning through terminal profiles.
12. Add AgentYard bridge CLI/API.
13. Add resume/restart flow.
14. Add reviewer/developer loop policies.
15. Add GitHub PR/CI watchers.

## Expected User Flow

User starts Feature A on Planet A.

The Analyze node spawns two analyzer terminals.

User moves to Planet B.

Feature B starts its own workflow with different terminals.

An analyzer from Planet A asks a question.

Planet A glows orange.

Feature A glows orange.

Analyzer tab glows orange.

HUD shows a pending notification.

User clicks the notification.

AgentYard navigates directly to:

```text
Planet A -> Feature A -> Analyze node -> Analyzer terminal tab -> question input
```

User answers once.

AgentYard routes the answer to the correct session.

Counts update.

Glow disappears when nothing is waiting.

## Success Criteria

- A user can run multiple features on the same project with different agent kinds.
- A user can run multiple planets at the same time.
- Each feature has isolated worktrees and durable sessions.
- Every agent has a terminal tab.
- Every terminal transcript is stored.
- Every pending question routes to the correct session.
- Waiting state bubbles to agent, feature, planet, and HUD.
- Notification clicks navigate to the exact agent tab.
- Restarting AgentYard preserves feature context.
- Lost PTY processes can be continued, resumed, or restarted with context.
- Workflows remain controlled by AgentYard, not by unstructured terminal text.
