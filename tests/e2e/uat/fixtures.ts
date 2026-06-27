import { test as base, expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

type UatEvent = {
  type: 'console' | 'pageerror' | 'requestfailed' | 'http'
  message: string
  url?: string
  method?: string
  status?: number
}

function shouldIgnoreUrl(url: string) {
  return (
    url.includes('/favicon.ico') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('devtools://')
  )
}

function shouldIgnoreResponse(url: string, status: number) {
  if (status < 400) return true
  return shouldIgnoreUrl(url)
}

function attachUatTelemetry(page: Page, testInfo: TestInfo) {
  const events: UatEvent[] = []

  page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return
    if (shouldIgnoreUrl(message.location().url)) return
    events.push({
      type: 'console',
      message: `[${message.type()}] ${message.text()}`,
      url: message.location().url,
    })
  })

  page.on('pageerror', (error) => {
    events.push({
      type: 'pageerror',
      message: error.stack ?? error.message,
    })
  })

  page.on('requestfailed', (request) => {
    events.push({
      type: 'requestfailed',
      message: request.failure()?.errorText ?? 'Request failed',
      method: request.method(),
      url: request.url(),
    })
  })

  page.on('response', (response) => {
    const status = response.status()
    const url = response.url()
    if (shouldIgnoreResponse(url, status)) return
    events.push({
      type: 'http',
      message: `HTTP ${status}`,
      status,
      url,
    })
  })

  return async () => {
    if (events.length === 0) return

    await testInfo.attach('uat-telemetry.json', {
      body: JSON.stringify(events, null, 2),
      contentType: 'application/json',
    })

    const serious = events.filter((event) => {
      if (event.type === 'console') return event.message.startsWith('[error]')
      if (event.type === 'http') return (event.status ?? 0) >= 500
      return true
    })

    expect(serious, 'UAT telemetry must not contain console errors, page errors, failed requests, or HTTP 5xx responses').toEqual([])
  }
}

export const test = base.extend<{ uatTelemetry: void }>({
  uatTelemetry: [
    async ({ page }, use, testInfo) => {
      const flushTelemetry = attachUatTelemetry(page, testInfo)
      await use()
      await flushTelemetry()
    },
    { auto: true },
  ],
})

export { expect }
