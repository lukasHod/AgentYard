# Workflow Editor & Execution — Test Plan

**Branch:** `feat/visual-workflow-editor`  
**Last updated:** 2026-06-26  
**App URL:** http://localhost:5173  
**API URL:** http://localhost:4242  

---

## Overview

This document covers the full test surface for:
1. **Visual Workflow Editor** — agent/skill sub-nodes, drag-to-reposition, persistence
2. **Workflow Execution** — feature creation triggering the DAG, agent spawning, terminal tabs
3. **Clarification Notifications** — inbox, navigation, answering

### Test Types Used

| Symbol | Type |
|--------|------|
| 🎭 | Playwright E2E (`e2e/*.spec.ts`) |
| 🧪 | Vitest unit (`*.test.tsx`) |
| ⚙️ | Node integration (`*.test.ts`) |

### Running Tests

```bash
# Unit tests only (fast, no browser, no API)
npm run test:client

# Schema/integration tests
npm run test:server

# E2E — requires app running + no live API needed
npm run test:e2e -- --grep "Workflow Editor"

# E2E — full suite including API-dependent tests
npm run test:e2e

# E2E headed (watch the browser)
npm run test:e2e:headed

# E2E UI mode (interactive)
npm run test:e2e:ui
```

### Tags for selective E2E runs

- `@slow @api` — tests that call the Anthropic API and spawn real agents (minutes each)
- Omit `--grep` to run all; use `--grep "^((?!@slow).)*$"` to skip API tests

---

## Prerequisites

1. App is running (`npm run dev` in the worktree directory)
2. At least one planet exists — navigate to http://localhost:5173 and create one if needed
3. Global agents seeded: `developer`, `tester`, `planner`, `reviewer`, `deployer` (seeded automatically on first start)
4. `ANTHROPIC_API_KEY` set in environment (required only for `@api` tests)

---

## Test Scenarios

---

### TS-01: Open Workflow Editor
**Type:** 🎭 Playwright E2E  
**File:** `e2e/workflow-editor.spec.ts`  
**Tags:** (none — fast, UI only)

**Steps:**
1. Navigate to `http://localhost:5173`
2. Wait for `canvas` element to appear (3D scene loaded)
3. Click on planet "FooDoo" in the 3D canvas (approximately center of viewport)
4. Wait for text "workflow editor" to appear in the FocusedPanel toolbar
5. Click the "⚙ workflow editor" button
6. Wait for text "WORKFLOW EDITOR" to appear in the overlay header
7. Verify `.react-flow` element is visible
8. Count `.react-flow__node[data-type="workflow"]` elements — expect ≥ 1

**Expected result:** The workflow editor overlay opens and displays the seeded default workflow nodes on the canvas.

---

### TS-02: Add AI Node
**Type:** 🎭 Playwright E2E  
**File:** `e2e/workflow-editor.spec.ts`

**Steps:**
1. Open workflow editor (follow TS-01 steps 1–7)
2. Count existing workflow nodes before adding
3. Click button "+ AI node" in the top toolbar
4. Count workflow nodes again — expect count + 1
5. Verify the new node is selected (`.react-flow__node.selected` exists)
6. Verify right sidebar shows text "RUNTIME" (node editor panel appeared)
7. Verify right sidebar shows text "AGENTS"

**Expected result:** A new AI node appears on the canvas and the right panel shows editable fields.

---

### TS-03: Assign Agent to Node and See Agent Sub-Node
**Type:** 🎭 Playwright E2E  
**File:** `e2e/workflow-editor.spec.ts`

**Steps:**
1. Open workflow editor
2. Click "+ AI node" to add a fresh node with no agents
3. In the right sidebar under "AGENTS", find the "developer" entry
4. Check the checkbox next to "developer"
5. Wait for `.react-flow__node[data-type="agentSub"]` with text "developer" to appear (timeout 5s)
6. Verify at least one SVG path exists in `.react-flow__edges` (the connecting edge)
7. Uncheck the "developer" checkbox
8. Wait for the "developer" agent sub-node to disappear (timeout 3s)

**Expected result:** Checking an agent shows a violet sub-node connected to the workflow node; unchecking removes it.

---

### TS-04: Agent Sub-Node is Draggable and Position Persists
**Type:** 🎭 Playwright E2E  
**File:** `e2e/workflow-visual-layout.spec.ts`

**Steps:**
1. Open workflow editor
2. Add AI node, assign "developer" agent
3. Get bounding box of "developer" agent sub-node → record position A
4. Use Playwright mouse API to drag the node 150px to the right
5. Verify bounding box moved by > 50px from position A
6. Click "save" button in the toolbar
7. Wait for "saved ✓" text on the button
8. Press Escape to close the editor
9. Click "⚙ workflow editor" again to reopen
10. Wait for "developer" agent sub-node to appear
11. Get its new bounding box → compare with position A
12. Verify the position is different from the original auto-layout default

**Expected result:** Agent sub-node is draggable; its position is serialized to `visualLayout` in the workflow graph and survives editor close/reopen.

---

### TS-05: Clicking Agent Sub-Node Opens ToolEditorModal
**Type:** 🎭 Playwright E2E  
**File:** `e2e/workflow-visual-layout.spec.ts`

**Steps:**
1. Open workflow editor
2. Add AI node, assign "developer" agent
3. Click the "developer" agent sub-node on the canvas
4. Verify a modal/overlay appears (ToolEditorModal)
5. Verify the modal contains the agent name "developer"
6. Verify the modal has a SKILLS section visible
7. Check a skill (e.g., "agentyard-style") if available
8. Click save in the modal
9. Verify the modal closes
10. If the agent now has skills, verify skill sub-nodes appear connected to the "developer" agent sub-node

**Expected result:** Clicking an agent sub-node opens its tool editor, and adding a skill immediately shows a skill sub-node on the canvas.

---

### TS-06: Skill Sub-Nodes Render with Correct Style
**Type:** 🎭 Playwright E2E  
**File:** `e2e/workflow-editor.spec.ts`

**Precondition:** The "developer" global agent has at least one skill. Checked via `GET http://localhost:4242/api/global-tools/agent/developer`. If `data.skills` is empty, test is skipped.

**Steps:**
1. Open workflow editor
2. Add AI node, assign "developer" agent
3. Wait for skill sub-nodes to appear (`.react-flow__node[data-type="skillSub"]`, timeout 5s)
4. Verify at least one skill sub-node is visible
5. Click a skill sub-node
6. Verify the node's inner div has a class containing "fuchsia" (vs "violet" for agent nodes)
7. Verify the skill sub-node has only a target handle (no source handle — skills are leaf nodes)

**Expected result:** Skill sub-nodes appear in fuchsia/purple styling, connected to the agent sub-node.

---

### TS-07: Save and Reload Workflow
**Type:** 🎭 Playwright E2E  
**File:** `e2e/workflow-editor.spec.ts`

**Steps:**
1. Open workflow editor
2. Click "+ AI node"
3. Assign "developer" agent
4. Verify "save" button is enabled (no `disabled` attribute / no `opacity-30` class)
5. Click "save"
6. Wait for button text to change to "saved ✓" (timeout 10s)
7. Press Escape to close the editor
8. Click "⚙ workflow editor" to reopen
9. Wait for `.react-flow` to be visible
10. Verify `.react-flow__node[data-type="agentSub"]` with text "developer" is present
11. Click the AI node on canvas
12. Verify "developer" checkbox is checked in the sidebar

**Expected result:** Workflow changes persist across editor sessions.

---

### TS-08: Create Feature Triggers Workflow
**Type:** 🎭 Playwright E2E `@slow @api`  
**File:** `e2e/feature-lifecycle.spec.ts`

**Steps:**
1. Navigate to `http://localhost:5173`
2. Click planet "FooDoo" — wait for FocusedPanel
3. Click "Features" tab button in the panel
4. Click "new feature" button (or equivalent create button)
5. Fill feature name field with unique value (e.g., `e2e-test-1719358800`)
6. Fill task field with: `Add a simple hello world endpoint`
7. Click submit/create button
8. Verify feature name appears in the features list (timeout 10s)
9. Wait for text "running" to appear in the feature row (timeout 20s) — confirms workflow started
10. Wait for `.xterm-viewport` to appear (timeout 30s) — confirms terminal session opened
11. Verify `.xterm-viewport` textContent length > 0

**Expected result:** Feature creation immediately triggers the configured workflow. A terminal session opens as the leader agent starts.

---

### TS-09: Terminal Tab Opens When Agent Spawns
**Type:** 🎭 Playwright E2E `@slow @api`  
**File:** `e2e/feature-lifecycle.spec.ts`

**Precondition:** Workflow has at least one AI node. The default workflow uses claude-sdk agents; for terminal tabs, the agentKind must be `claude-code-cli`. Adjust the test workflow if needed.

**Steps:**
1. Create a feature (follow TS-08 steps 1–8)
2. Wait for at least one `.xterm-viewport` element to appear (timeout 30s)
3. Count visible `.xterm-viewport` elements — expect ≥ 1
4. For each terminal viewport:
   a. Click its associated session tab header
   b. Verify `.xterm-viewport` is visible and non-empty
5. Verify terminal text content is not all whitespace

**Expected result:** Each spawned CLI agent gets its own visible terminal tab with live output.

---

### TS-10: Clarification Notification Appears in Inbox
**Type:** 🎭 Playwright E2E `@slow @api`  
**File:** `e2e/clarification.spec.ts`

**Precondition:** An agent with the `agentyard-smoke-test` skill is configured in the workflow. This skill instructs the agent to call `request_clarification`.

**Steps:**
1. Navigate to app, click FooDoo planet
2. Open Features tab
3. Create feature with task `smoke-test: request clarification`
4. Wait for the notification inbox to appear — look for text "INBOX" in amber styling (timeout 90s)
5. Verify at least one notification row is visible
6. Read notification row text — verify it contains a question or context
7. Verify notification row contains planet/feature name

**Expected result:** The amber INBOX panel appears with a pending clarification question from the agent.

---

### TS-11: Clicking Notification Navigates to Agent Tab
**Type:** 🎭 Playwright E2E `@slow @api`  
**File:** `e2e/clarification.spec.ts`

**Steps:**
1. Follow TS-10 steps 1–6 — notification is visible
2. Click on the notification row (the clickable planet/feature name link)
3. Wait 500ms for navigation animation
4. Verify the FocusedPanel now shows the feature name (camera navigated)
5. Verify at least one `.xterm-viewport` or answer input field is visible
6. Verify an input field is present (for answering the clarification)

**Expected result:** Clicking the notification navigates the 3D camera to the feature and shows the agent's terminal tab.

---

### TS-12: Answering Clarification Resumes Agent
**Type:** 🎭 Playwright E2E `@slow @api`  
**File:** `e2e/clarification.spec.ts`

**Steps:**
1. Follow TS-10/TS-11 — notification is visible and inbox is shown
2. In the inline answer form (inside the notification row), type: `Please proceed with the default approach`
3. Press Enter or click the ✓ submit button
4. Wait for the notification row to disappear (timeout 15s)
5. Verify text "INBOX" is no longer visible (inbox cleared)
6. Wait 5s for feature to continue running
7. Verify no "failed" text appears in the feature list

**Expected result:** The agent receives the answer and continues execution. The inbox clears.

---

### TS-13: Workflow Nodes Execute in Sequence
**Type:** 🎭 Playwright E2E `@slow @api`  
**File:** `e2e/feature-lifecycle.spec.ts`

**Precondition:** Default workflow with analyze → develop sequence is active.

**Steps:**
1. Navigate to app, create a feature with task `Create a simple utility function`
2. Wait for first `.xterm-viewport` to appear — record terminal count as `phase1Count`
3. Wait (up to 120s) for total terminal count to exceed `phase1Count`
4. Verify new terminal count > `phase1Count`

**Rationale:** analyze node spawns planner + reviewer (2 terminals). When it completes, develop spawns developer + tester (2 more terminals). Sequential execution means count grows in batches.

**Expected result:** Terminal count grows in two waves — first batch for analyze, second batch for develop — proving sequential node execution.

---

### TS-14: Node With Multiple Agents Spawns Multiple Terminal Tabs
**Type:** 🎭 Playwright E2E `@slow @api`  
**File:** `e2e/feature-lifecycle.spec.ts`

**Steps:**
1. Open workflow editor
2. Click "+ AI node"
3. In sidebar, check "developer" and "tester" checkboxes
4. Verify 2 agent sub-nodes appear on canvas
5. Click "save", close editor
6. Create feature with task `Add logging to the app`
7. Wait for `.xterm-viewport` elements to appear (timeout 30s)
8. Count terminal viewports — expect ≥ 2

**Expected result:** A node with 2 assigned agents results in ≥ 2 terminal sessions when executed.

---

### TS-15: Delete Node Removes Agent and Skill Sub-Nodes
**Type:** 🎭 Playwright E2E  
**File:** `e2e/workflow-editor.spec.ts`

**Steps:**
1. Open workflow editor
2. Click "+ AI node"
3. Assign "developer" agent
4. Verify "developer" agent sub-node is visible on canvas
5. Verify the new node is selected (it becomes selected when added)
6. Click "delete" button in the toolbar
7. Wait 500ms
8. Verify "developer" agent sub-node is no longer visible (timeout 3s)
9. Verify the workflow node itself is gone (count of `.react-flow__node[data-type="workflow"]` decreased)

**Expected result:** Deleting a workflow node removes it and all its associated agent/skill sub-nodes from the canvas.

---

## Unit Tests

### UT-01: `buildSubNodes` — no agents
**Type:** 🧪 Vitest  
**File:** `src/client/views/editor/buildSubNodes.test.ts`

Input: workflow node with empty `agents: []`  
Expected: `agentNodes = []`, `skillNodes = []`, `subEdges = []`

---

### UT-02: `buildSubNodes` — one agent, no skills
**Type:** 🧪 Vitest

Input: node with `agents: ['developer']`, `agentDetailMap` has developer with no skills  
Expected: 1 agent node, 0 skill nodes, 1 sub-edge

---

### UT-03: `buildSubNodes` — one agent, two skills
**Type:** 🧪 Vitest

Input: developer with `skills: ['skill-a', 'skill-b']`  
Expected: 1 agent node, 2 skill nodes, 3 edges (1 wf→agent + 2 agent→skill)

---

### UT-04: `buildSubNodes` — uses saved positions from visualLayout
**Type:** 🧪 Vitest

Input: `visualLayout.agents['n1::developer'] = { x: 999, y: 888 }`  
Expected: agent node position equals `{ x: 999, y: 888 }`

---

### UT-05: `buildSubNodes` — multiple workflow nodes are independent
**Type:** 🧪 Vitest

Input: two nodes n1 (developer) and n2 (tester)  
Expected: 2 agent nodes with different parent ids; keys contain respective node ids

---

### UT-06: `AgentSubNode` renders name and type label
**Type:** 🧪 Vitest  
**File:** `src/client/views/editor/AgentSubNode.test.tsx`

---

### UT-07: `AgentSubNode` calls onClick with correct args
**Type:** 🧪 Vitest

---

### UT-08: `AgentSubNode` has target and source handles
**Type:** 🧪 Vitest

---

### UT-09: `SkillSubNode` renders skill name
**Type:** 🧪 Vitest  
**File:** `src/client/views/editor/SkillSubNode.test.tsx`

---

### UT-10: `SkillSubNode` has only target handle (no source)
**Type:** 🧪 Vitest

---

## Integration Tests

### IT-01: WorkflowGraph schema validates with visualLayout
**Type:** ⚙️ Node integration  
**File:** `src/core/schema.test.ts`

Parse a `WorkflowGraph` with `visualLayout` containing agent and skill positions.  
Expected: Zod parse succeeds; positions accessible at correct keys.

---

### IT-02: WorkflowGraph schema validates without visualLayout
**Type:** ⚙️ Node integration

Parse a `WorkflowGraph` with no `visualLayout` field.  
Expected: Zod parse succeeds; `visualLayout` is `undefined`.

---

### IT-03: WorkflowGraph rejects invalid position
**Type:** ⚙️ Node integration

Parse a `WorkflowGraph` where an agent position object is missing `x`.  
Expected: Zod parse fails with validation error.

---

### IT-04: WorkflowGraph visualLayout round-trips through API
**Type:** ⚙️ Node integration  
**File:** `src/server/workflows.test.ts` (extend existing)

1. Create/update a workflow with `visualLayout` via `PUT /api/workflows/:id`
2. Fetch it back via `GET /api/workflows/:id`
3. Assert `visualLayout.agents` and `visualLayout.skills` match the saved values

---

## Visual Verification (Manual)

After implementation, verify manually in the browser:

1. Open http://localhost:5173
2. Click the FooDoo planet
3. Click "⚙ workflow editor"
4. The existing "Analyze" node has agents `planner` and `reviewer` — verify two violet sub-nodes are connected to it
5. Click "Develop" node — verify `developer` and `tester` sub-nodes appear
6. If developer has skills, verify fuchsia skill sub-nodes connected to the developer sub-node
7. Drag an agent sub-node to a new position
8. Click "save" — button shows "saved ✓"
9. Close and reopen editor — sub-node should be at the saved position
10. Click an agent sub-node — ToolEditorModal should open for that agent

---

## Known Limitations

- **3D planet click is positional:** The `AppPage.clickPlanet()` helper clicks the canvas center. If the planet is not centered, click coordinates need adjustment. Consider adding `data-testid` attributes to the FocusedPanel trigger for more reliable selection in CI.
- **API-dependent tests are slow:** `@slow @api` tests can take 2–10 minutes each depending on Claude's response speed. Run them separately or in off-hours CI jobs.
- **Terminal content assertions are fragile:** xterm.js renders in a canvas/DOM hybrid. Text content extraction via `textContent()` may return whitespace only. If `TS-09` is flaky, assert on WebSocket messages or server-side events instead.
- **`visualLayout` position delta after reload:** Due to React Flow's auto-fit-view on open, absolute pixel positions shift. The position comparison in TS-04 uses a delta > 20px threshold to account for minor zoom differences.
