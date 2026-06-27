import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e/uat',
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'e2e-uat-results/results.json' }],
    ['html', { outputFolder: 'e2e-uat-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    headless: false,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      slowMo: 40,
    },
  },
  projects: [
    {
      name: 'uat-chromium-headed',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
