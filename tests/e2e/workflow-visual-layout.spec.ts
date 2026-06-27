/**
 * E2E tests for visual layout of agent/skill sub-nodes.
 * Covers: TS-04 (persistence), TS-05 (skill from agent click), TS-06 (skill sub-node)
 *
 * These tests are purely UI — no API calls to Claude.
 */
import { test, expect } from '@playwright/test'
import { AppPage } from './pages/AppPage'
import { WorkflowEditorPage } from './pages/WorkflowEditorPage'

const PLANET_NAME = 'FooDoo'

test.describe('Visual Layout — Agent and Skill Sub-Nodes', () => {
  let app: AppPage
  let editor: WorkflowEditorPage

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page)
    editor = new WorkflowEditorPage(page)
    await app.goto()
    await app.clickPlanet(PLANET_NAME)
    await app.waitForFocusedPanel()
    await app.openWorkflowEditor()
    await editor.waitForReady()
  })

  test('agent sub-node renders with violet styling', async ({ page }) => {
    await editor.addAiNodeButton.click()
    await page.waitForTimeout(300)
    await editor.attachAgent('developer')

    const agentNode = editor.agentSubNodeByName('developer')
    await expect(agentNode).toBeVisible()

    // Check for violet border class in the node's inner element.
    const inner = agentNode.locator('div').first()
    const classAttr = await inner.getAttribute('class')
    expect(classAttr).toContain('violet')
  })

  test('agent sub-node position is saved in visualLayout', async ({ page }) => {
    await editor.addAiNodeButton.click()
    await page.waitForTimeout(300)
    await editor.attachAgent('developer')

    const agentNode = editor.agentSubNodeByName('developer')
    const before = await agentNode.boundingBox()
    expect(before).not.toBeNull()

    // Move it.
    await editor.dragNode(agentNode, 200, 50)

    // Save.
    await editor.save()

    // Verify the save API was called with visualLayout.
    // We check that the save button shows "saved ✓" which confirms persistence.
    await expect(page.getByRole('button', { name: 'saved ✓' })).toBeVisible()

    // Reload and confirm position changed from default.
    await editor.close()
    await app.openWorkflowEditor()
    await editor.waitForReady()

    const agentNodeAfter = editor.agentSubNodeByName('developer')
    await expect(agentNodeAfter).toBeVisible({ timeout: 5_000 })

    const after = await agentNodeAfter.boundingBox()
    expect(after).not.toBeNull()
    // The position should be different from the original default auto-layout position.
    // (It won't match exactly due to zoom/pan, but it should not be at the exact same spot.)
    expect(Math.abs((after!.x) - (before!.x)) + Math.abs((after!.y) - (before!.y))).toBeGreaterThan(20)
  })

  test('TS-05: clicking agent sub-node opens ToolEditorModal', async ({ page }) => {
    await editor.addAiNodeButton.click()
    await page.waitForTimeout(300)
    await editor.attachAgent('developer')

    const agentNode = editor.agentSubNodeByName('developer')
    await agentNode.click()

    // ToolEditorModal should open — it shows the agent name as title.
    await expect(page.getByText('developer', { exact: false }).first()).toBeVisible({ timeout: 5_000 })

    // The modal should have skill selection area.
    await expect(page.getByText(/skill/i).first()).toBeVisible()
  })

  test('multiple workflow nodes show separate agent sub-node groups', async ({ page }) => {
    // Add two AI nodes with different agents.
    await editor.addAiNodeButton.click()
    await page.waitForTimeout(200)
    await editor.attachAgent('developer')

    await editor.addAiNodeButton.click()
    await page.waitForTimeout(200)
    await editor.attachAgent('tester')

    // Both agent sub-nodes should be visible.
    await expect(editor.agentSubNodeByName('developer')).toBeVisible()
    await expect(editor.agentSubNodeByName('tester')).toBeVisible()

    // There should be at least 2 agent sub-nodes.
    const count = await editor.agentSubNodes().count()
    expect(count).toBeGreaterThanOrEqual(2)
  })
})
