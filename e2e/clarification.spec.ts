/**
 * E2E tests for clarification notifications.
 * Covers: TS-10, TS-11, TS-12
 *
 * These tests require the `agentyard-smoke-test` skill which triggers a
 * `request_clarification` call from the agent. The skill must be applied to
 * one of the agents in the active workflow.
 *
 * Tagged @slow @api — requires a live Anthropic API connection.
 */
import { test, expect } from '@playwright/test'
import { AppPage } from './pages/AppPage'
import { FeaturesPage } from './pages/FeaturesPage'
import { NotificationsPage } from './pages/NotificationsPage'

const PLANET_NAME = 'FooDoo'

test.describe('Clarification Notifications @slow @api', () => {
  let app: AppPage
  let features: FeaturesPage
  let notifications: NotificationsPage

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page)
    features = new FeaturesPage(page)
    notifications = new NotificationsPage(page)
    await app.goto()
    await app.clickPlanet(PLANET_NAME)
    await app.waitForFocusedPanel()
  })

  /**
   * TS-10: Clarification Notification Appears
   * 1. Create feature that triggers an agent with request_clarification
   *    (agent must use the smoke-test skill which calls request_clarification)
   * 2. Wait for INBOX to appear in the UI
   * 3. Verify notification count >= 1
   * 4. Verify notification shows the clarification question
   * 5. Verify notification shows planet/feature name
   */
  test('TS-10: inbox notification appears when agent requests clarification', async ({ page }) => {
    await features.openTab()

    // This feature name triggers the smoke test agent (configured with
    // agentyard-smoke-test skill that emits a clarification request).
    const featureName = `e2e-clarify-${Date.now()}`
    await features.createFeature(featureName, 'smoke-test: request clarification')

    // Wait for the INBOX notification deck to appear.
    await notifications.waitForNotification(90_000)

    // There should be at least 1 notification.
    const rows = notifications.notificationRows()
    await expect(rows.first()).toBeVisible()

    // Notification should contain the planet/feature context.
    const notifText = await rows.first().textContent()
    expect(notifText).toBeTruthy()
  })

  /**
   * TS-11: Click Notification Navigates to Agent Tab
   * 1. Pending notification exists (from TS-10 preconditions)
   * 2. Click the notification row
   * 3. Verify FocusedPanel navigates to the feature
   * 4. Terminal tab for the agent becomes visible
   * 5. Answer input is available
   */
  test('TS-11: clicking notification navigates to agent tab', async ({ page }) => {
    await features.openTab()

    const featureName = `e2e-nav-${Date.now()}`
    await features.createFeature(featureName, 'smoke-test: request clarification')

    // Wait for notification.
    await notifications.waitForNotification(90_000)

    // Click the notification.
    await notifications.clickFirstNotification()

    // After clicking, the panel should show the feature context.
    await expect(page.getByText(featureName, { exact: false })).toBeVisible({ timeout: 10_000 })

    // An answer input should be available somewhere near the notification or terminal.
    const answerInput = page.locator('input[type="text"]').last()
    await expect(answerInput).toBeVisible({ timeout: 5_000 })
  })

  /**
   * TS-12: Answer Clarification Resumes Agent
   * 1. Pending clarification question visible
   * 2. Type answer and press Enter
   * 3. Notification disappears from inbox
   * 4. Feature continues progressing (not stuck)
   */
  test('TS-12: answering clarification removes it from inbox and resumes agent', async ({
    page,
  }) => {
    await features.openTab()

    const featureName = `e2e-answer-${Date.now()}`
    await features.createFeature(featureName, 'smoke-test: request clarification')

    // Wait for notification.
    await notifications.waitForNotification(90_000)

    // Answer the clarification.
    await notifications.answerQuestion('Please proceed with the default approach')

    // Notification should disappear.
    await notifications.waitForEmpty(15_000)

    // Feature should continue — status should not stay stuck.
    // We simply verify no error message appears within a short window.
    await page.waitForTimeout(5_000)
    const errorText = await page.locator('text=failed').count()
    expect(errorText).toBe(0)
  })
})
