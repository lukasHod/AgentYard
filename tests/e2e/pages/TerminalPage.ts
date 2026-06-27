import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

export class TerminalPage {
  constructor(readonly page: Page) {}

  /** Wait for at least N terminal session tabs to appear. */
  async waitForTerminalTabs(minCount: number, timeout = 30_000) {
    await this.page.waitForFunction(
      (n: number) => document.querySelectorAll('.xterm-viewport').length >= n,
      minCount,
      { timeout },
    )
  }

  /** Get all visible terminal viewports. */
  allTerminals(): Locator {
    return this.page.locator('.xterm-viewport')
  }

  /** Wait for terminal output to contain a substring. */
  async waitForOutput(terminalIndex: number, text: string, timeout = 30_000) {
    const terminal = this.allTerminals().nth(terminalIndex)
    await expect(terminal).toContainText(text, { timeout })
  }

  /** Get session tab headers (show agent role or feature name). */
  sessionHeaders(): Locator {
    return this.page.locator('[data-testid="terminal-session-header"]')
  }
}
