# Agent Guidance

## UI Verification

Use headed Playwright UAT for AgentYard UI verification instead of Chrome MCP by default.

- Run `npm run test:uat` for fast headed UAT checks.
- Put temporary agent-authored UAT specs in `tests/e2e/uat/`.
- Import `test` and `expect` from `tests/e2e/uat/fixtures.ts` so console errors, page errors, failed requests, and HTTP failures are captured automatically.
- Use `npm run test:uat:debug` when a headed run needs step-through debugging.
- Use Chrome MCP only when Playwright cannot inspect or drive the state needed for the task.

For implementation details, read `docs/plans/playwright-agentic-uat.md`.
