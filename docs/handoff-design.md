# Feature Handoff Design

## Problem

Developers working on AgentYard features (each in its own git worktree) need to pass in-progress work to a colleague. The colleague must have full context — agent conversation history, workflow state, feature description, and implementation plan — so their Claude can continue without losing thread.

## Constraints

- No backend (pure npm package)
- Works via git (the shared medium is the planet's origin remote)
- Feature branch must stay clean (no handoff artifacts in its history)

## Solution

A handoff lives on a dedicated orphan branch `agentyard/handoff/<feature-branch>` on origin. It contains a single `handoff.json` commit with all context. The feature branch is never touched.

## Handoff Payload (`handoff.json`)

```typescript
{
  version: 1,
  branch: string,              // feature branch (e.g. agentyard/my-feature-42)
  featureId: number,
  planetId: number,
  featureName: string,
  shortDescription: string,    // 1–2 sentences shown in the Handoffs tab UI
  featureDescription: string,  // full feature intent, injected into agent context
  implementationPlan: string | null,
  handoffNote: string | null,  // optional note from sender
  sender: string,              // git user.name
  timestamp: number,
  agents: [{id, role, label, messages: [{role, content, timestamp}]}],
  workflowState: {nodeStates, nodeSummaries}
}
```

## Git Operations

All git plumbing uses `child_process.execFile` (not `simple-git`) because `mktree` requires stdin input that `simple-git.raw()` doesn't support.

**Create:** `hash-object` → `mktree` (stdin) → `commit-tree` → `update-ref` → `push`  
**List:** `fetch --prune` then `for-each-ref refs/remotes/origin/agentyard/handoff/`  
**Pickup:** `show <ref>:handoff.json` then `push --delete`

## Pickup Flow

1. Read `handoff.json` from the orphan branch
2. Create a new `features` row in SQLite
3. Create a local worktree on the EXISTING feature branch (`createPickupWorktree` — `git worktree add <path> <branch>` without `-b`, fetching from origin first)
4. Store the full handoff payload as `handoff_context` JSON on the feature row
5. Delete the orphan handoff branch from origin
6. When the feature run starts, format the payload into a context block prepended to every AI-node leader's system prompt

## Context Injection

In `runWorkflowOnSessions.ts`, if `opts.handoffContext` is set, it is prepended to `input.prompt` for the leader session. `features.ts` route parses `handoff_context` and calls `formatHandoffContext(payload)` before starting the run.

## UI

- **Handoffs tab** on the planet panel (next to INBOX): fetches `GET /api/planets/:id/handoffs` on mount, lists pending handoffs with Pick up / Cancel buttons
- **Hand off button** on each pending/running feature in the Features tab: opens `HandoffDialog` with four fields (shortDescription, featureDescription, implementationPlan, handoffNote)

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/planets/:id/handoffs` | List pending handoffs on origin |
| `POST` | `/api/planets/:id/handoffs` | Create handoff from a feature |
| `POST` | `/api/planets/:id/handoffs/pickup` | Pick up a handoff |
| `DELETE` | `/api/planets/:id/handoffs/:branch` | Cancel a handoff |

## Database

Migration 4: `ALTER TABLE features ADD COLUMN handoff_context TEXT`

Stores the full serialized `HandoffPayload` so handoff context survives feature restarts.
