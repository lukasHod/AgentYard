/**
 * E2E tests for feature creation triggering workflows.
 * Covers: TS-08, TS-09, TS-13, TS-14
 *
 * WARNING: These tests actually spawn Claude CLI sessions and hit the Anthropic API.
 * Run them only in environments where API keys are configured and billing is expected.
 * They are tagged @slow and @api to allow selective execution:
 *   npx playwright test --grep @slow
 */
import { test, expect } from '@playwright/test'
import { AppPage } from './pages/AppPage'
import { FeaturesPage } from './pages/FeaturesPage'
import { TerminalPage } from './pages/TerminalPage'
import { WorkflowEditorPage } from './pages/WorkflowEditorPage'

const PLANET_NAME = 'FooDoo'

test.describe('Feature Lifecycle — Workflow Execution @slow @api', () => {
  let app: AppPage
  let features: FeaturesPage
  let terminal: TerminalPage

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page)
    features = new FeaturesPage(page)
    terminal = new TerminalPage(page)
    await app.goto()
    await app.clickPlanet(PLANET_NAME)
    await app.waitForFocusedPanel()
  })

  /**
   * TS-08: Create Feature Triggers Workflow
   * 1. Navigate to app, click FooDoo planet
   * 2. Click Features tab
   * 3. Click "new feature"
   * 4. Enter name "e2e-test-feature", task "Add a simple hello world endpoint"
   * 5. Submit
   * 6. Verify feature appears in list
   * 7. Wait up to 10s for status "running"
   * 8. Verify at least one terminal session appears
   * 9. Verify terminal shows output
   */
  test('TS-08: creating a feature triggers the workflow and shows terminal', async ({ page }) => {
    await features.openTab()

    const featureName = `e2e-ts08-${Date.now()}`
    await features.createFeature(featureName, 'Add a simple hello world endpoint')

    // Feature should appear in the list.
    await expect(page.getByText(featureName)).toBeVisible({ timeout: 10_000 })

    // Wait for workflow to start — status changes from idle to running.
    await expect(page.locator('text=running').first()).toBeVisible({ timeout: 20_000 })

    // At least one terminal session should appear.
    await expect(terminal.allTerminals().first()).toBeVisible({ timeout: 30_000 })
  })

  /**
   * TS-09: Terminal Tab Opens When Agent Spawns
   * 1. Precondition: workflow node uses claude-code-cli agentKind
   * 2. Create feature
   * 3. Wait for workflow to start
   * 4. Verify terminal tab(s) appear (one per agent)
   * 5. Click each terminal tab — verify xterm viewport is visible
   * 6. Verify terminal shows non-empty output
   */
  test('TS-09: terminal tabs open for each spawned agent', async ({ page }) => {
    await features.openTab()

    const featureName = `e2e-ts09-${Date.now()}`
    await features.createFeature(featureName, 'Write a README.md file with project description')

    // Wait for at least one terminal to appear.
    await terminal.allTerminals().first().waitFor({ timeout: 30_000 })

    // Each visible terminal viewport should be non-empty (has content).
    const count = await terminal.allTerminals().count()
    expect(count).toBeGreaterThanOrEqual(1)

    // Verify terminal content is not blank.
    const firstTerminal = terminal.allTerminals().first()
    const content = await firstTerminal.textContent()
    expect(content?.trim().length).toBeGreaterThan(0)
  })

  /**
   * TS-13: Workflow Node Sequence Validation
   * 1. Ensure workflow has 2+ sequential nodes (analyze → develop)
   * 2. Create feature
   * 3. First node's agents spawn first — check terminal count at t=0 vs t=30s
   * 4. Wait for first node to complete
   * 5. Second node's agents spawn after first completes
   *
   * This test validates ordering via terminal session count changes over time.
   */
  test('TS-13: workflow nodes execute in sequence', async ({ page }) => {
    // The default workflow has analyze → develop in sequence.
    // When analyze starts, 1-2 terminals appear (planner + reviewer).
    // After analyze completes, develop starts and 2 more terminals appear (developer + tester).

    await features.openTab()

    const featureName = `e2e-ts13-${Date.now()}`
    await features.createFeature(featureName, 'Create a simple utility function')

    // Wait for first batch of terminals.
    await terminal.allTerminals().first().waitFor({ timeout: 30_000 })
    const phase1Count = await terminal.allTerminals().count()
    expect(phase1Count).toBeGreaterThanOrEqual(1)

    // Wait for more terminals to appear (second node starting).
    // This can take a while depending on API response times.
    await page.waitForFunction(
      (initialCount: number) => document.querySelectorAll('.xterm-viewport').length > initialCount,
      phase1Count,
      { timeout: 120_000 },
    )

    const phase2Count = await terminal.allTerminals().count()
    expect(phase2Count).toBeGreaterThan(phase1Count)
  })

  /**
   * TS-14: Multiple Agents in One Node
   * 1. Open workflow editor
   * 2. Add AI node with developer + tester agents
   * 3. Save, close editor
   * 4. Create feature
   * 5. Verify 2 terminal tabs appear when that node executes
   */
  test('TS-14: node with multiple agents spawns multiple terminal tabs', async ({ page }) => {
    test.setTimeout(120_000)
    const editor = new WorkflowEditorPage(page)

    // Open workflow editor and add a node with 2 agents.
    await app.openWorkflowEditor()
    await editor.waitForReady()

    await editor.addAiNodeButton.click()
    await page.waitForTimeout(300)

    // Assign developer and tester.
    await editor.attachAgent('developer')
    await editor.attachAgent('tester')

    // Verify at least 2 agent sub-nodes appear (the canvas may have more from other nodes).
    const subNodeCount = await editor.agentSubNodes().count()
    expect(subNodeCount).toBeGreaterThanOrEqual(2)

    await editor.save()
    await editor.close()

    // Create a feature that runs the workflow.
    await features.openTab()
    const featureName = `e2e-ts14-${Date.now()}`
    await features.createFeature(featureName, 'Add logging to the app')

    // Wait for at least 2 terminals to appear (one per agent in the multi-agent node).
    await terminal.waitForTerminalTabs(2, 60_000)
    const termCount = await terminal.allTerminals().count()
    expect(termCount).toBeGreaterThanOrEqual(2)
  })
})
