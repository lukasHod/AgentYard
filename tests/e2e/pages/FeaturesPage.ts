import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export class FeaturesPage {
  constructor(readonly page: Page) {}

  /** Click the Features tab in the FocusedPanel. */
  async openTab() {
    await this.page.getByRole('button', { name: /features/i }).first().click()
    await this.page.waitForTimeout(300)
  }

  /** Create a new feature with the given name and task. */
  async createFeature(name: string, task: string) {
    // Click "new feature" or the create button.
    const newBtn = this.page.getByRole('button', { name: /new feature/i }).first()
    await newBtn.click()

    // Fill in name field.
    const nameInput = this.page.getByPlaceholder(/feature name/i).first()
    await nameInput.fill(name)

    // Fill in task field.
    const taskInput = this.page.getByPlaceholder(/task|describe/i).first()
    await taskInput.fill(task)

    // Submit.
    const submitBtn = this.page.getByRole('button', { name: /create|start|submit/i }).first()
    await submitBtn.click()
  }

  /** Wait for a feature to appear in the list with a given status. */
  async waitForFeatureStatus(featureName: string, status: string, timeout = 30_000) {
    await expect(
      this.page.locator('[data-testid="feature-row"]').filter({ hasText: featureName }),
    ).toContainText(status, { timeout })
  }

  /** Wait for feature status to NOT be 'idle' (i.e., workflow started). */
  async waitForFeatureRunning(featureName: string, timeout = 20_000) {
    // Feature row should show 'running' status.
    await this.page
      .locator('text=running')
      .first()
      .waitFor({ timeout })
  }
}
