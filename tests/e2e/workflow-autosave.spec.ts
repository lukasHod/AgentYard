/**
 * E2E test: Workflow editor autosave.
 *
 * Verifies that adding a node (or any dirty change) is automatically
 * persisted within ~2 seconds without the user clicking the save button.
 *
 * Preconditions:
 *   - App running at baseURL
 *   - At least one planet exists
 */
import { test, expect } from '@playwright/test'
import { AppPage } from './pages/AppPage'
import { WorkflowEditorPage } from './pages/WorkflowEditorPage'

test.describe('Workflow Editor — autosave', () => {
  test('TS-AS01: new AI node is persisted automatically without clicking save', async ({ page }) => {
    const app = new AppPage(page)
    const editor = new WorkflowEditorPage(page)

    await app.goto()
    await app.clickAnyPlanet()
    await app.openWorkflowEditor()
    await editor.waitForReady()

    // Record node count before adding.
    const beforeCount = await page.locator('.react-flow__node-workflow').count()

    // Add a node but do NOT click save.
    await editor.addAiNodeButton.click()
    await expect(page.locator('.react-flow__node-workflow')).toHaveCount(
      beforeCount + 1,
      { timeout: 5_000 },
    )

    // Save button should be enabled showing "save" (not yet saved).
    await expect(editor.saveButton).toHaveText('save')

    // Wait for autosave to fire and complete (max 5 s).
    await expect(editor.saveButton).toHaveText('saved ✓', { timeout: 5_000 })

    // Reload — this clears all React state and re-fetches from DB.
    await page.reload()
    await page.waitForSelector('canvas', { timeout: 15_000 })

    // Re-open the editor.
    await app.clickAnyPlanet()
    await app.openWorkflowEditor()
    await editor.waitForReady()

    // The node should survive the reload → was actually saved to DB.
    const afterCount = await page.locator('.react-flow__node-workflow').count()
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 1)
  })
})
