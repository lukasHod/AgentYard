# Claude Guidance

## UI Verification

For AgentYard UAT, prefer headed Playwright over Chrome MCP.

- Run `npm run test:uat` to verify UI functionality in headed Chromium.
- Add short-lived UAT specs under `tests/e2e/uat/` and import from `./fixtures`.
- Treat attached `uat-telemetry.json` as the first debugging surface for console, page, and network errors.
- Use `npm run test:uat:debug` for interactive Playwright debugging.
- Reserve Chrome MCP for exploratory cases where Playwright cannot expose the required state.

See `docs/plans/playwright-agentic-uat.md` for the full implementation plan.
