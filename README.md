# AgentYard

A gamified agent orchestrator. Each project is a "ship" docked in a 2D sci-fi shipyard; agents are "drones" that build features under a "leader" agent; notifications feel like incoming transmissions. Built on the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).

> **Status:** Phase 1 — single-agent loop wired up (Claude Agent SDK, `request_clarification` tool, barge-in chat). Smoke test passes structurally; verify end-to-end Claude responses by refreshing your auth first.

## Auth

AgentYard inherits Claude credentials from the environment it runs in. The Claude Agent SDK supports either:

- **Anthropic API key** — `ANTHROPIC_API_KEY` env var
- **AWS Bedrock** — `CLAUDE_CODE_USE_BEDROCK=1` plus valid AWS credentials (and `AWS_REGION`)
- **Google Vertex** — `CLAUDE_CODE_USE_VERTEX=1` plus valid GCP credentials

If you're on Bedrock and see `authentication_failed` 403s in the server log, your AWS token has likely expired — refresh via your usual flow (`aws sso login`, MFA refresh, etc.) and restart the dev server.

## Quick start

```bash
npm install
npm run dev
```

- Server starts on `http://localhost:4242`
- Vite dev server on `http://localhost:5173` (this is the URL to visit during development)
- Type a message, watch the agent reply. Try: *"Use the request_clarification tool to ask what color my favorite is, then acknowledge."* You should see the amber "incoming transmission" panel, reply, and the agent continues.

Smoke test (assumes `npm run dev` already running):

```bash
npx tsx scripts/smoke.ts
```

Production build + run:

```bash
npm run build
npm start
```

The packaged CLI (`npx agentyard`) will eventually replace `npm start`.

## Layout

```
src/
  server/      Node server: HTTP, Socket.IO, SQLite, agent runtime (later)
  client/      React + Vite UI (later: PixiJS game canvas)
  core/        Shared types & schemas
```

## Design

See [`docs/design.md`](docs/design.md) for the full design doc: context, locked decisions, data model, agent runtime architecture, UI surfaces, phased implementation plan, critical files.
