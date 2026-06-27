import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

export class NotificationsPage {
  constructor(readonly page: Page) {}

  /** The INBOX notification panel. */
  inboxPanel(): Locator {
    return this.page.locator('text=INBOX').first()
  }

  /** Wait for at least one notification to appear. */
  async waitForNotification(timeout = 60_000) {
    await this.inboxPanel().waitFor({ timeout })
  }

  /** Get all notification rows. */
  notificationRows(): Locator {
    return this.page.locator('[data-testid="notification-row"]')
  }

  /** Click the first notification row (navigates to the agent). */
  async clickFirstNotification() {
    await this.notificationRows().first().click()
    await this.page.waitForTimeout(500)
  }

  /** Type an answer into the inline answer form and submit. */
  async answerQuestion(answer: string) {
    const input = this.page.locator('input[placeholder*="answer"], input[placeholder*="reply"]').first()
    await input.fill(answer)
    await input.press('Enter')
  }

  /** Wait for the notification inbox to be empty (all answered). */
  async waitForEmpty(timeout = 15_000) {
    await expect(this.inboxPanel()).not.toBeVisible({ timeout })
  }
}
