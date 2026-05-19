# AgentYard

A gamified agent orchestrator. Each project is a "ship" docked in a 2D sci-fi shipyard; agents are "drones" that build features under a "leader" agent; notifications feel like incoming transmissions. Built on the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).

> **Status:** Phase 0 — scaffolding. The dev shell is running but the agent runtime is not yet wired up.

## Quick start

```bash
npm install
npm run dev
```

- Server starts on `http://localhost:4242`
- Vite dev server on `http://localhost:5173` (this is the URL to visit during development)

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
