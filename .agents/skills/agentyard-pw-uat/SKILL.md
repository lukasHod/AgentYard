---
name: agentyard-pw-uat
description: Use headed Playwright for fast AgentYard UI UAT. Trigger when an agent must verify UI behavior, run user acceptance test cases, inspect console/page/network errors, debug frontend regressions, or choose between Playwright and Chrome MCP for local AgentYard browser testing.
---

# AgentYard Playwright UAT

## Overview

Use the repo's headed Playwright UAT path instead of Chrome MCP for routine UI verification. The goal is to let Playwright execute the browser work quickly while the agent reads compact reports and only uses interactive browser tools for unusual debugging.

## Commands

- Run UAT: `npm run test:uat`
- Debug UAT: `npm run test:uat:debug`
- Config: `playwright.uat.config.ts`
- Temporary specs: `tests/e2e/uat/*.spec.ts`
- Full plan: `docs/plans/playwright-agentic-uat.md`

## Workflow

1. Translate the user's UI checklist into one or more short specs under `e2e/uat/`.
2. Import from the UAT fixture:

   ```ts
   import { expect, test } from './fixtures'
   ```

3. Use role, label, text, and stable CSS locators. Reuse existing page objects from `e2e/pages/` when they match the flow.
4. Run `npm run test:uat`.
5. Inspect test output, `e2e-uat-results/results.json`, the HTML report, screenshots, traces, videos, and attached `uat-telemetry.json`.
6. Fix product code or the test flow, then rerun the smallest relevant UAT spec.
7. Remove throwaway specs unless the scenario should become regression coverage.

## Telemetry Rules

The UAT fixture automatically records console warnings/errors, uncaught page errors, failed requests, and HTTP 4xx/5xx responses.

The run fails for console errors, page errors, failed requests, and HTTP 5xx responses. HTTP 4xx responses and console warnings are attached for review; explain whether they are expected.

## Chrome MCP Policy

Do not use Chrome MCP for ordinary UAT execution. Use it only when Playwright cannot expose the required state, such as manual inspection of an unusual browser extension surface or a tool-specific in-app browser issue.

## Minimal Spec Template

```ts
import { expect, test } from './fixtures'

test('user can complete the requested UAT flow', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible()
  // Continue with the user-provided steps.
})
```
