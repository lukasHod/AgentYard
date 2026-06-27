import type { Page } from '@playwright/test'

/**
 * Top-level page object for the AgentYard 3D app.
 * The app is a single-page 3D solar system — navigation is achieved by
 * clicking planets in the canvas, which opens the FocusedPanel.
 */
export class AppPage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto('/')
    // Wait for the 3D canvas to load
    await this.page.waitForSelector('canvas', { timeout: 15_000 })
  }

  /**
   * Navigate to a planet by clicking the 3D canvas at the planet's approximate
   * position. Falls back to waiting for the FocusedPanel to appear (the panel
   * shows when any planet is focused).
   *
   * NOTE: The 3D camera may need a moment to settle. The helper clicks the center
   * of the viewport where the first visible planet typically renders, then waits
   * for the panel to appear. If this is flaky, prefer using keyboard shortcuts or
   * direct API calls to set up state before asserting UI.
   */
  async clickPlanet(planetName: string) {
    // The FocusedPanel is open only when "workflow editor" is visible (that button
    // lives exclusively in the FocusedPanel toolbar). Matching the planet name
    // anywhere in the DOM is insufficient — it also matches sidebar lists.
    const panelOpen = await this.page
      .getByText('workflow editor', { exact: false })
      .isVisible()
      .catch(() => false)
    if (panelOpen) {
      const planetInPanel = await this.page
        .getByText(planetName, { exact: false })
        .isVisible()
        .catch(() => false)
      if (planetInPanel) return
    }

    // Click the canvas center where the planet is likely to be.
    const canvas = this.page.locator('canvas').first()
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas not found')
    await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    // Wait for FocusedPanel to appear with the planet name.
    await this.page
      .getByText(planetName, { exact: false })
      .first()
      .waitFor({ timeout: 10_000 })
  }

  /** Wait for the FocusedPanel to be visible (any planet focused). */
  async waitForFocusedPanel() {
    // The workflow editor button is only shown in the focused panel.
    await this.page.getByText('workflow editor', { exact: false }).waitFor({ timeout: 10_000 })
  }

  /** Click the "⚙ workflow editor" button in the FocusedPanel toolbar. */
  async openWorkflowEditor() {
    await this.page.getByText('workflow editor', { exact: false }).click()
    await this.page.getByText('WORKFLOW EDITOR', { exact: false }).waitFor({ timeout: 5_000 })
  }
}
