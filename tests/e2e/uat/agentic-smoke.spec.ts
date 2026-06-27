import { expect, test } from './fixtures'

test.describe('Agentic UAT smoke', () => {
  test('loads the app shell without browser telemetry failures', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas').first()).toBeVisible()
  })
})
