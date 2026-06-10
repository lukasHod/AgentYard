# AgentYard

A gamified agent orchestrator. Each project is a "ship" docked in a 2D sci-fi shipyard; agents are "drones" that build features under a "leader" agent; notifications feel like incoming transmissions. Built on the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).

> **Status:** Phase 1 — single-agent loop verified end-to-end (Claude Agent SDK, `request_clarification` tool, barge-in chat). `scripts/smoke.ts` passes.

## Auth

AgentYard inherits Claude credentials from the parent process. The Claude Agent SDK supports any one of:

- **Default Claude Code OAuth** (recommended) — credentials cached at `~/.claude/.credentials.json` after running `claude login`. No env vars needed.
- **Anthropic API key** — set `ANTHROPIC_API_KEY`.
- **AWS Bedrock** — set `CLAUDE_CODE_USE_BEDROCK=1` + valid AWS credentials + `AWS_REGION`.
- **Google Vertex** — set `CLAUDE_CODE_USE_VERTEX=1` + valid GCP credentials.

If a 403 `authentication_failed` retry loop appears in the server log, one of the above is needed (or the active one is expired).

## Quick start

```bash
npm install
npm run dev
```

- AgentYard automatically picks free localhost ports for the server and Vite UI.
- The terminal prints the actual URLs, for example `http://localhost:4242` and `http://localhost:5173`.
- Type a message, watch the agent reply. Try: *"Use the request_clarification tool to ask what color my favorite is, then acknowledge."* You should see the amber "incoming transmission" panel, reply, and the agent continues.

If you need fixed ports while working beside another app, run the pieces manually:

```bash
npm run dev:server -- --port 4242
npm run dev:client -- --port 5174
```

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
