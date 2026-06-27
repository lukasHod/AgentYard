# Playwright Agentic UAT Implementation Plan

## Goal

Use Playwright as the default UI verification path for agents. Agents should run fast headed UAT checks from natural-language scenarios, capture browser telemetry, and use Chrome MCP only for unusual exploratory debugging.

## Current Baseline

- The regular E2E suite lives in `tests/e2e/` and runs with `playwright.config.ts`.
- The regular suite is intentionally serial because the app uses shared SQLite state.
- The new UAT path lives in `tests/e2e/uat/` and runs with `playwright.uat.config.ts`.
- UAT runs headed Chromium by default so the agent can visually verify behavior while still collecting machine-readable failures.

## Configuration

- `playwright.config.ts`: keep for normal E2E and CI-style regression.
- `playwright.uat.config.ts`: use for agentic UAT.
- `npm run test:uat`: run headed UAT scenarios.
- `npm run test:uat:debug`: run headed UAT with Playwright debug tooling.
- `tests/e2e/uat/fixtures.ts`: auto-captures console warnings/errors, page errors, failed requests, and HTTP 4xx/5xx responses.

## Agent Workflow

1. Convert the user's UAT checklist into one or more temporary specs under `tests/e2e/uat/`.
2. Import `test` and `expect` from `./fixtures`.
3. Prefer role/text/test-id locators and existing page objects when they already fit.
4. Run `npm run test:uat`.
5. Read the list/json reporter output plus any attached `uat-telemetry.json`.
6. Debug failures in code or with Playwright debug mode.
7. Delete throwaway specs when they are only investigation artifacts; keep valuable regression specs.

## Telemetry Policy

The UAT fixture fails on:

- uncaught page errors
- failed network requests
- console errors
- HTTP 5xx responses

HTTP 4xx responses and console warnings are attached to the report for investigation. Agents should mention relevant warnings or expected 4xx responses in their final report.

## Rollout Plan

1. Keep existing `e2e` tests unchanged.
2. Add new feature UAT scenarios in `tests/e2e/uat/` during implementation work.
3. Promote stable, repeat-worthy UAT scenarios into regular E2E specs when they become long-term regression coverage.
4. Use Chrome MCP only when headed Playwright cannot expose the needed UI state.

## Future Enhancements

- Add a YAML-to-spec generator if natural-language UAT checklists become frequent.
- Add per-scenario database seeding when tests need parallel workers.
- Add `data-testid` attributes to high-value UI controls that are hard to select reliably.
- Add a compact custom reporter that writes one agent-readable Markdown summary per UAT run.
