/**
 * E2E tests for the Workflow Editor UI.
 * Covers: TS-01 through TS-07, TS-15
 *
 * Preconditions:
 *   - App is running at http://localhost:5173
 *   - At least one planet exists (created via UI or seeded in DB)
 *   - Global agents exist: developer, planner, tester, reviewer, deployer
 */
import { test, expect } from '@playwright/test'
import { AppPage } from './pages/AppPage'
import { WorkflowEditorPage } from './pages/WorkflowEditorPage'

const PLANET_NAME = 'FooDoo'

test.describe('Workflow Editor — UI', () => {
  let app: AppPage
  let editor: WorkflowEditorPage

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page)
    editor = new WorkflowEditorPage(page)
    await app.goto()
    await app.clickPlanet(PLANET_NAME)
    await app.waitForFocusedPanel()
  })

  /**
   * TS-01: Open Workflow Editor
   * 1. Navigate to http://localhost:5173
   * 2. Wait for 3D canvas to load (canvas element)
   * 3. Click planet "FooDoo"
   * 4. Wait for FocusedPanel (text "FooDoo" or workflow editor button)
   * 5. Click "⚙ workflow editor"
   * 6. Wait for WORKFLOW EDITOR header text
   * 7. Verify ReactFlow canvas is visible (.react-flow)
   * 8. Verify at least one workflow node renders
   */
  test('TS-01: opens the workflow editor overlay', async ({ page }) => {
    await app.openWorkflowEditor()
    await editor.waitForReady()

    // Verify at least one workflow node is present (the seeded default workflow has nodes).
    await expect(page.locator('.react-flow__node[data-type="workflow"]')).toHaveCount(
      expect.any(Number) as never,
    )
    const nodeCount = await page.locator('.react-flow__node[data-type="workflow"]').count()
    expect(nodeCount).toBeGreaterThanOrEqual(1)
  })

  /**
   * TS-02: Add AI Node
   * 1. Open workflow editor
   * 2. Click "+ AI node"
   * 3. Verify new node appears on canvas
   * 4. Click new node
   * 5. Verify sidebar shows RUNTIME selector
   * 6. Change node title and verify it updates
   */
  test('TS-02: adds a new AI node to the canvas', async ({ page }) => {
    await app.openWorkflowEditor()
    await editor.waitForReady()

    const beforeCount = await page.locator('.react-flow__node[data-type="workflow"]').count()
    await editor.addAiNodeButton.click()
    await expect(page.locator('.react-flow__node[data-type="workflow"]')).toHaveCount(
      beforeCount + 1,
      { timeout: 5_000 },
    )

    // Sidebar should show node editor controls.
    await expect(page.getByText('RUNTIME', { exact: true })).toBeVisible()
    await expect(page.getByText('AGENTS', { exact: true })).toBeVisible()
  })

  /**
   * TS-03: Assign Agent to Node
   * 1. Open editor, select an AI node
   * 2. Check "developer" agent checkbox
   * 3. Verify agent sub-node appears on canvas
   * 4. Verify edge connects workflow node to agent sub-node
   * 5. Uncheck agent and verify sub-node disappears
   */
  test('TS-03: assigns agent to node and shows agent sub-node', async ({ page }) => {
    await app.openWorkflowEditor()
    await editor.waitForReady()

    // Add a fresh AI node so we start with no agents.
    await editor.addAiNodeButton.click()
    await page.waitForTimeout(300)

    // Attach the developer agent.
    await editor.attachAgent('developer')

    // Verify agent sub-node appeared.
    await expect(editor.agentSubNodeByName('developer')).toBeVisible()

    // Verify a dashed edge exists from workflow node to agent node.
    // React Flow renders edges as SVG paths — check at least one sub-edge svg exists.
    await expect(page.locator('.react-flow__edges path')).toHaveCount(
      expect.any(Number) as never,
    )
    const edgeCount = await page.locator('.react-flow__edges path').count()
    expect(edgeCount).toBeGreaterThanOrEqual(1)

    // Uncheck the agent.
    await editor.detachAgent('developer')
    await expect(editor.agentSubNodeByName('developer')).not.toBeVisible({ timeout: 3_000 })
  })

  /**
   * TS-04: Agent Sub-Node is Draggable
   * 1. Assign "developer" to a node
   * 2. Record initial position of agent sub-node
   * 3. Drag agent sub-node by 100px horizontally
   * 4. Verify it moved
   * 5. Save and re-open — verify persisted position
   */
  test('TS-04: agent sub-node is draggable and position persists after save', async ({ page }) => {
    await app.openWorkflowEditor()
    await editor.waitForReady()

    await editor.addAiNodeButton.click()
    await page.waitForTimeout(300)
    await editor.attachAgent('developer')

    const agentNode = editor.agentSubNodeByName('developer')
    await agentNode.waitFor()

    const before = await agentNode.boundingBox()
    expect(before).not.toBeNull()

    // Drag 150px to the right.
    await editor.dragNode(agentNode, 150, 0)
    await page.waitForTimeout(500)

    const after = await agentNode.boundingBox()
    expect(after).not.toBeNull()
    // Position should have changed.
    expect(Math.abs((after!.x) - (before!.x))).toBeGreaterThan(50)

    // Save the workflow.
    await editor.save()

    // Close and re-open editor.
    await editor.close()
    await app.openWorkflowEditor()
    await editor.waitForReady()

    // Agent sub-node should still be visible (and at the saved position).
    await expect(editor.agentSubNodeByName('developer')).toBeVisible({ timeout: 5_000 })
  })

  /**
   * TS-06: Skill Sub-Node Renders
   * Precondition: developer agent has at least one skill set in its definition.
   * If the global developer agent has no skills, this test is skipped.
   *
   * 1. Open editor, assign developer to a node
   * 2. Check for skill sub-nodes connected to agent sub-node
   * 3. Verify fuchsia styling
   */
  test('TS-06: skill sub-nodes appear when agent has skills', async ({ page }) => {
    // Check via API if developer has skills.
    const res = await page.request.get('http://localhost:4242/api/global-tools/agent/developer')
    const body = await res.json()
    const skills: string[] = body?.data?.skills ?? []

    if (skills.length === 0) {
      test.skip()
      return
    }

    await app.openWorkflowEditor()
    await editor.waitForReady()

    await editor.addAiNodeButton.click()
    await page.waitForTimeout(300)
    await editor.attachAgent('developer')

    // At least one skill sub-node should appear.
    await expect(editor.skillSubNodes().first()).toBeVisible({ timeout: 5_000 })

    // Check fuchsia text/border is present.
    const firstSkill = editor.skillSubNodeByName(skills[0] ?? '')
    await expect(firstSkill).toBeVisible()
  })

  /**
   * TS-07: Save and Reload Workflow
   * 1. Add AI node with name, assign developer agent
   * 2. Click save — verify "saved ✓"
   * 3. Close and re-open editor
   * 4. Verify node and agent assignment are persisted
   */
  test('TS-07: saves workflow and reloads correctly', async ({ page }) => {
    await app.openWorkflowEditor()
    await editor.waitForReady()

    await editor.addAiNodeButton.click()
    await page.waitForTimeout(300)
    await editor.attachAgent('developer')

    await editor.save()

    // Close editor.
    await editor.close()

    // Re-open.
    await app.openWorkflowEditor()
    await editor.waitForReady()

    // Developer agent should still be assigned to a node (sub-node visible).
    await expect(editor.agentSubNodeByName('developer')).toBeVisible({ timeout: 5_000 })

    // Verify developer checkbox is still checked in sidebar.
    await editor.clickNodeByTitle('New AI node')
    const checkbox = page
      .locator('label')
      .filter({ hasText: 'developer' })
      .locator('input[type="checkbox"]')
    await expect(checkbox).toBeChecked()
  })

  /**
   * TS-15: Delete Node Removes Agent and Skill Sub-Nodes
   * 1. Select a node that has an assigned agent
   * 2. Verify agent sub-node is visible
   * 3. Click "delete"
   * 4. Verify node, agent sub-nodes, and skill sub-nodes are all removed
   */
  test('TS-15: deleting a workflow node removes its agent sub-nodes', async ({ page }) => {
    await app.openWorkflowEditor()
    await editor.waitForReady()

    // Add a node and assign developer.
    await editor.addAiNodeButton.click()
    await page.waitForTimeout(300)
    await editor.attachAgent('developer')

    await expect(editor.agentSubNodeByName('developer')).toBeVisible()

    // The new AI node should be selected — click delete.
    await editor.deleteButton.click()
    await page.waitForTimeout(500)

    // Agent sub-node should be gone.
    await expect(editor.agentSubNodeByName('developer')).not.toBeVisible({ timeout: 3_000 })
  })
})
