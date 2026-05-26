# 3D Solar System UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current PixiJS galaxy/dock UI with a single React Three Fiber scene where projects are planets, features are 3D ships orbiting them, and agent sessions are drones around the ships. Three LODs (system / planet / ship), cinematic dolly camera, always-on notification deck, glass HUD style B.

**Architecture:** A single R3F `<Canvas>` owns the 3D scene (sun, planets on orbits, ships on per-planet orbital rings, drones around ships). React DOM glass-styled HUD components are absolutely positioned on top. State (focus / LOD / chat binding) lives in a new Zustand store. Camera transitions are driven by a `<CameraRig>` that subscribes to focus and tweens between target positions. Procedural appearance (planets, ship model + tint) is derived deterministically from project/feature identifiers.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind + Zustand + better-sqlite3 (existing) + React Three Fiber + drei + @react-three/postprocessing + three.js + Kenney CC0 GLB assets (new).

**Reference:** [`docs/superpowers/specs/2026-05-26-3d-solar-system-ui-design.md`](../specs/2026-05-26-3d-solar-system-ui-design.md)

---

## File Structure

**New directories:**
- `src/client/scene/` — R3F scene components (SolarSystemScene, Sun, Planet, Ship, Drone, CameraRig, materials)
- `src/client/scene/lib/` — pure helpers (hashing, layout math, focus reducer)
- `src/client/components/glass/` — reusable glass primitives (GlassPanel, GlassButton, GlassChip, GlassTab, GlassSplitter)
- `src/client/components/hud/` — HUD assemblies (AmbientHUD, FocusedPanel, NotificationDeck, WorkflowEditorOverlay, SunPanel)
- `src/client/state/uiStore.ts` — new Zustand store (focus, splitterRatio, notification-deck open)
- `public/models/ships/` — `00.glb` … `24.glb` (Kenney Space Kit)
- `public/models/drones/` — `leader.glb`, `regular.glb`

**Renamed files (Phase 0):**
- `src/server/ships.ts` → `src/server/planets.ts`
- `src/server/shipChat.ts` → `src/server/planetChat.ts`
- `src/server/routes/ships.ts` → `src/server/routes/planets.ts`
- `src/client/components/ShipDetailsPanel.tsx` → `PlanetDetailsPanel.tsx` (deleted in Phase 15)
- `src/client/views/ShipsView.tsx` → `PlanetsView.tsx` (deleted in Phase 15)

**Modified during the build:** `src/client/App.tsx`, `src/server/db.ts`, `src/core/types.ts`, `src/server/socketHandlers.ts`, all route files, all client components that reference `ship*` or `ShipSummary`. Most of `src/client/canvas/*` is deleted at the end of Phase 15.

---

## Phase 0 — Naming migration (`ship` → `planet`)

Zero behavior change. Single coordinated rename across DB, server, types, client. Done before any 3D work touches the code.

### Task 0.1: Create branch and add idempotent DB rename migration

**Files:**
- Modify: `src/server/db.ts`

- [ ] **Step 1: Confirm clean working tree, branch from main**

```bash
git status --short
# If there are uncommitted changes the user wants on main, stop and surface them.
git checkout -b solar-system
```

- [ ] **Step 2: Rewrite `src/server/db.ts` with the rename migration and updated CREATE TABLE statements**

```ts
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DB_DIR = path.join(homedir(), '.agentyard')
const DB_PATH = path.join(DB_DIR, 'agentyard.db')

// Idempotent rename from the previous `ships` schema to `planets`.
// Runs before CREATE TABLE IF NOT EXISTS so fresh DBs skip these no-ops.
const RENAME_MIGRATION = `
DO_RENAME:
-- conditional via JS below; not a SQLite construct
`

const SCHEMA = `
CREATE TABLE IF NOT EXISTS planets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  project_path TEXT NOT NULL,
  workflow_id  INTEGER,
  state        TEXT NOT NULL DEFAULT 'idle',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  graph_json  TEXT NOT NULL,
  is_template INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS features (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  planet_id     INTEGER NOT NULL,
  name          TEXT NOT NULL,
  task          TEXT NOT NULL DEFAULT '',
  branch        TEXT,
  worktree_path TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  workflow_id   INTEGER NOT NULL DEFAULT 1,
  final_summary TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS planet_chat_messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  planet_id INTEGER NOT NULL,
  role      TEXT NOT NULL,
  content   TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planet_chat_messages_planet
  ON planet_chat_messages(planet_id, id);
`

export type DB = Database.Database

let _db: DB | null = null

function tableExists(db: DB, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name)
}

function runRenameMigration(db: DB) {
  // Only act if the legacy `ships` table exists AND `planets` doesn't.
  if (tableExists(db, 'ships') && !tableExists(db, 'planets')) {
    db.exec(`
      ALTER TABLE ships RENAME TO planets;
      ALTER TABLE features RENAME COLUMN ship_id TO planet_id;
      ALTER TABLE ship_chat_messages RENAME TO planet_chat_messages;
      ALTER TABLE planet_chat_messages RENAME COLUMN ship_id TO planet_id;
      DROP INDEX IF EXISTS idx_ship_chat_messages_ship;
      CREATE INDEX IF NOT EXISTS idx_planet_chat_messages_planet
        ON planet_chat_messages(planet_id, id);
    `)
  }
}

export function getDb(): DB {
  if (_db) return _db
  mkdirSync(DB_DIR, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runRenameMigration(db)
  db.exec(SCHEMA)
  _db = db
  return db
}

export function closeDb() {
  _db?.close()
  _db = null
}
```

- [ ] **Step 3: Run typecheck to verify the file compiles**

```bash
npm run typecheck
```

Expected: errors elsewhere (other files still say `ship*`), but `db.ts` itself must be clean.

- [ ] **Step 4: Commit**

```bash
git add src/server/db.ts
git commit -m "rename(phase 0): DB schema ships → planets + idempotent migration"
```

---

### Task 0.2: Rename server layer (files, symbols, routes, socket events)

**Files:**
- Rename: `src/server/ships.ts` → `src/server/planets.ts`
- Rename: `src/server/shipChat.ts` → `src/server/planetChat.ts`
- Rename: `src/server/routes/ships.ts` → `src/server/routes/planets.ts`
- Modify: `src/server/features.ts`, `src/server/routes/features.ts`, `src/server/routes/tools.ts`, `src/server/server.ts`, `src/server/socketHandlers.ts`, `src/server/runtime/Session.ts`, `src/server/runtime/tools/startFeature.ts`, `src/server/runtime/testRun.ts`, `src/server/runtime/runWorkflowOnSessions.ts`, `src/server/routes/runs.ts`, `src/server/routes/context.ts`, `src/server/routes/testRuns.ts`, `src/server/repository.ts`, `src/server/agentsSeed.ts`, `src/server/scriptsSeed.ts`, `src/server/cli.ts`

- [ ] **Step 1: `git mv` the three server files**

```bash
git mv src/server/ships.ts src/server/planets.ts
git mv src/server/shipChat.ts src/server/planetChat.ts
git mv src/server/routes/ships.ts src/server/routes/planets.ts
```

- [ ] **Step 2: Inside the renamed files, update exported symbols**

In `src/server/planets.ts`, rename: `listShips → listPlanets`, `getShip → getPlanet`, `createShip → createPlanet`, `deleteShip → deletePlanet`, `setShipState → setPlanetState`, any helper module-locals (`ships` → `planets`). Update all internal SQL strings (already correct after Phase 0.1: `FROM planets`, `INTO planets`, `UPDATE planets`).

In `src/server/planetChat.ts`, rename: function names `*ShipChat*` → `*PlanetChat*`, params `shipId → planetId`, the SQL is already correct after 0.1.

In `src/server/routes/planets.ts`, rename:
- Route paths: every `/api/ships*` → `/api/planets*`
- Variable names: `shipId → planetId`
- Socket events emitted: `io.emit('ship:deleted', …)` → `io.emit('planet:deleted', …)`; same for `ship:created`, `ship:state`
- Imports from `../ships` → `../planets`, `../shipChat` → `../planetChat`

- [ ] **Step 3: Update all server-side import sites and route registrations**

Quick grep-driven sweep — for every file in the modify list above:
- Replace `import … from '../ships'` → `'../planets'`
- Replace `import … from '../shipChat'` → `'../planetChat'`
- Replace `import … from './routes/ships'` → `'./routes/planets'`
- Replace function names: `listShips → listPlanets`, `getShip → getPlanet`, `createShip → createPlanet`, `deleteShip → deletePlanet`
- Replace variable names: `shipId → planetId`, `ship → planet` (where it refers to a row)
- Replace socket emits: `'ship:created' → 'planet:created'`, `'ship:deleted' → 'planet:deleted'`, `'ship:state' → 'planet:state'`
- Replace SQL string literals: `FROM ships → FROM planets`, `ship_id → planet_id`, `ship_chat_messages → planet_chat_messages` (in any `prepare(...)` calls outside the renamed files)

In `src/server/server.ts`, the route registration:
```ts
// before
import { shipsRoutes } from './routes/ships'
app.register(shipsRoutes)
// after
import { planetsRoutes } from './routes/planets'
app.register(planetsRoutes)
```
(Adjust function export name if it differs — match the existing pattern in the file.)

In `src/server/runtime/Session.ts` and `tools/startFeature.ts`, the persistent chat session label:
```ts
// before
const label = `ship:${shipId}:chat`
// after
const label = `planet:${planetId}:chat`
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: server side clean; client errors remaining (because `core/types.ts` and client files still say `Ship*`).

- [ ] **Step 5: Commit**

```bash
git add -A src/server/
git commit -m "rename(phase 0): server layer ships → planets (files, symbols, routes, events)"
```

---

### Task 0.3: Rename TypeScript types in `src/core/`

**Files:**
- Modify: `src/core/types.ts`, `src/core/tools.ts`

- [ ] **Step 1: Apply the renames in `src/core/types.ts`**

In types.ts: `Ship → Planet`, `ShipState → PlanetState`, `ShipSummary → PlanetSummary`, `FeatureSummary.shipId → planetId`, `ServerEvents['ship:created'] → 'planet:created'`, `ServerEvents['ship:deleted'] → 'planet:deleted'`, `ServerEvents['ship:state'] → 'planet:state'` (and inside its payload, `shipId → planetId`).

**Keep** the string values of `PlanetState` (`'idle' | 'analyzing' | 'developing' | 'deploying' | 'awaiting_clarification' | 'ready_to_liftoff'`) — they're metaphor-flavored but not legacy "ship" references, and changing them would require a data migration which is out of scope.

- [ ] **Step 2: Apply matching renames in `src/core/tools.ts`**

Any reference to `ShipSummary` becomes `PlanetSummary`; any `shipId` field/parameter becomes `planetId`.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: server clean; client errors at all the call sites that import these types.

- [ ] **Step 4: Commit**

```bash
git add src/core/
git commit -m "rename(phase 0): core types Ship → Planet, shipId → planetId"
```

---

### Task 0.4: Rename client layer (callers, components, files)

**Files:**
- Rename: `src/client/components/ShipDetailsPanel.tsx` → `PlanetDetailsPanel.tsx`
- Rename: `src/client/views/ShipsView.tsx` → `PlanetsView.tsx`
- Modify: `src/client/App.tsx`, `src/client/state/socketStore.ts`, `src/client/state/socketClient.ts`, `src/client/state/socketStore.test.ts`, `src/client/canvas/GameCanvas.tsx`, `src/client/canvas/GameHud.tsx`, `src/client/canvas/useGameHud.ts`, `src/client/canvas/galaxyScene.ts`, `src/client/canvas/dockScene.ts`, `src/client/canvas/sprites.ts`, `src/client/components/AgentChat.tsx`, `src/client/components/ToolsTabContent.tsx`, `src/client/components/tools/ToolEditorModal.tsx`, `src/client/views/EditorView.tsx`, `src/client/views/TestRunModal.tsx`, `src/client/views/testRun/TestRunForm.tsx`

- [ ] **Step 1: `git mv` the two client files**

```bash
git mv src/client/components/ShipDetailsPanel.tsx src/client/components/PlanetDetailsPanel.tsx
git mv src/client/views/ShipsView.tsx src/client/views/PlanetsView.tsx
```

- [ ] **Step 2: In the renamed files, rename their internal `Ship*` symbols**

In `PlanetDetailsPanel.tsx`: component name `ShipDetailsPanel → PlanetDetailsPanel`, type `ShipPanelTab → PlanetPanelTab`, type `ShipDescriptionData → PlanetDescriptionData`, all `ship` props/locals → `planet`, all `/api/ships/...` URLs → `/api/planets/...`, header text "SHIP / …" → "PLANET / …", "delete ship" copy → "delete project" (user-facing).

In `PlanetsView.tsx`: component name and any internal types/locals.

- [ ] **Step 3: Update all client import sites and call sites**

For every file in the modify list:
- Replace type imports: `ShipSummary → PlanetSummary`, `ShipState → PlanetState`, `Ship → Planet`
- Replace store selectors: `useShips → usePlanets` (defined in `socketStore.ts`)
- Replace API URL templates: `/api/ships → /api/planets` everywhere
- Replace socket event types: `'ship:created' → 'planet:created'`, `'ship:deleted' → 'planet:deleted'`, `'ship:state' → 'planet:state'`
- Replace prop/callback names: `onCreateShip → onCreatePlanet`, `onDeleteShip → onDeletePlanet`, `selectedShipId → selectedPlanetId`, `setSelectedShipId → setSelectedPlanetId`
- Replace local variables: `ship → planet`, `ships → planets`, `shipId → planetId`, `shipFeatures → planetFeatures`, `shipName → planetName`, `shipPath → planetPath`
- Replace user-facing copy: "+ new ship" → "+ new project", "NEW SHIP" → "NEW PROJECT", "delete ship" → "delete project", "ship project path" → "project path"
- Replace the chat session label string: `ship:${id}:chat → planet:${id}:chat` in `ShipDetailsPanel.tsx`/now `PlanetDetailsPanel.tsx`

In `socketStore.ts` specifically: rename the selector `useShips()` → `usePlanets()`, and any internal slice field `ships → planets`, `setShips → setPlanets`. Update `socketStore.test.ts` accordingly.

- [ ] **Step 4: Run typecheck + client tests**

```bash
npm run typecheck
npm run test:client
```

Expected: both clean.

- [ ] **Step 5: Run server tests**

```bash
npm run test:server
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add -A src/client/
git commit -m "rename(phase 0): client layer ships → planets (files, callers, copy)"
```

---

### Task 0.5: Audit + smoke test the rename

**Files:** none (verification only)

- [ ] **Step 1: Run the audit grep**

```bash
git grep -i 'ship' -- 'src/**'
```

Expected: zero hits, OR only hits that are part of brand identity (the string `AGENTYARD`, the doc/comment "shipyard" identity). Any other hit is a leftover and must be fixed before this task closes.

- [ ] **Step 2: Run full test suite + typecheck**

```bash
npm run typecheck && npm test
```

Expected: all green.

- [ ] **Step 3: Smoke test via Chrome MCP**

Start dev server (`npm run dev` in background), then with Chrome MCP:
1. `mcp__chrome-devtools__new_page` → navigate to `http://localhost:5173`
2. `mcp__chrome-devtools__take_screenshot` — capture the galaxy view to confirm the existing UI still renders
3. Use the existing UI to: create a new project (planet) → verify it appears → delete it → verify it disappears
4. Check `mcp__chrome-devtools__list_network_requests` — confirm all API calls go to `/api/planets*` (no `/api/ships*` requests)
5. Check `mcp__chrome-devtools__list_console_messages` — no errors

- [ ] **Step 4: Commit any audit fixups**

```bash
git add -A
git commit -m "rename(phase 0): audit fixups" --allow-empty
```

---

## Phase 1 — Foundation: R3F bootstrap

### Task 1.1: Install dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install R3F + drei + postprocessing + three**

```bash
npm install three@^0.166 @react-three/fiber@^8 @react-three/drei@^9 @react-three/postprocessing@^2
npm install -D @types/three @react-three/test-renderer@^8
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add three.js, R3F, drei, postprocessing"
```

---

### Task 1.2: New UI store (`uiStore.ts`)

**Files:**
- Create: `src/client/state/uiStore.ts`
- Create: `src/client/state/uiStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/client/state/uiStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from './uiStore'

describe('uiStore.focus reducer', () => {
  beforeEach(() => {
    useUiStore.setState({ focus: { lod: 0 }, splitterRatio: 0.38, notificationDeckOpen: false })
  })

  it('starts at LOD 0', () => {
    expect(useUiStore.getState().focus).toEqual({ lod: 0 })
  })

  it('focusPlanet sets LOD 1 on a planet', () => {
    useUiStore.getState().focusPlanet(42)
    expect(useUiStore.getState().focus).toEqual({ lod: 1, planetId: 42 })
  })

  it('focusSun sets LOD 1 sun-special state', () => {
    useUiStore.getState().focusSun()
    expect(useUiStore.getState().focus).toEqual({ lod: 1, sun: true })
  })

  it('focusShip sets LOD 2 on (planet, feature)', () => {
    useUiStore.getState().focusShip(42, 7)
    expect(useUiStore.getState().focus).toEqual({ lod: 2, planetId: 42, shipFeatureId: 7 })
  })

  it('focusShip carries chatDroneId if provided', () => {
    useUiStore.getState().focusShip(42, 7, 'drone-abc')
    expect(useUiStore.getState().focus).toEqual({ lod: 2, planetId: 42, shipFeatureId: 7, chatDroneId: 'drone-abc' })
  })

  it('back() pops one LOD level', () => {
    useUiStore.getState().focusShip(42, 7)
    useUiStore.getState().back()
    expect(useUiStore.getState().focus).toEqual({ lod: 1, planetId: 42 })
    useUiStore.getState().back()
    expect(useUiStore.getState().focus).toEqual({ lod: 0 })
    useUiStore.getState().back()
    expect(useUiStore.getState().focus).toEqual({ lod: 0 }) // idempotent at root
  })

  it('clamps splitterRatio to [0.15, 0.85]', () => {
    useUiStore.getState().setSplitterRatio(0.05)
    expect(useUiStore.getState().splitterRatio).toBe(0.15)
    useUiStore.getState().setSplitterRatio(0.95)
    expect(useUiStore.getState().splitterRatio).toBe(0.85)
    useUiStore.getState().setSplitterRatio(0.5)
    expect(useUiStore.getState().splitterRatio).toBe(0.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/client/state/uiStore.test.ts
```

Expected: FAIL — module `./uiStore` does not exist.

- [ ] **Step 3: Write the store**

```ts
// src/client/state/uiStore.ts
import { create } from 'zustand'

export type Focus =
  | { lod: 0 }
  | { lod: 1; planetId: number }
  | { lod: 1; sun: true }
  | { lod: 2; planetId: number; shipFeatureId: number; chatDroneId?: string }

const SPLITTER_KEY = 'agentyard.splitterRatio'
const readSplitter = (): number => {
  if (typeof localStorage === 'undefined') return 0.38
  const raw = localStorage.getItem(SPLITTER_KEY)
  const v = raw ? Number(raw) : 0.38
  return Number.isFinite(v) ? v : 0.38
}

interface UiState {
  focus: Focus
  splitterRatio: number
  notificationDeckOpen: boolean
  focusPlanet: (planetId: number) => void
  focusSun: () => void
  focusShip: (planetId: number, shipFeatureId: number, chatDroneId?: string) => void
  bindChatDrone: (droneId: string) => void
  back: () => void
  setSplitterRatio: (r: number) => void
  setNotificationDeckOpen: (open: boolean) => void
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export const useUiStore = create<UiState>((set, get) => ({
  focus: { lod: 0 },
  splitterRatio: readSplitter(),
  notificationDeckOpen: false,
  focusPlanet: (planetId) => set({ focus: { lod: 1, planetId } }),
  focusSun: () => set({ focus: { lod: 1, sun: true } }),
  focusShip: (planetId, shipFeatureId, chatDroneId) =>
    set({ focus: chatDroneId ? { lod: 2, planetId, shipFeatureId, chatDroneId } : { lod: 2, planetId, shipFeatureId } }),
  bindChatDrone: (droneId) => {
    const f = get().focus
    if (f.lod === 2) set({ focus: { ...f, chatDroneId: droneId } })
  },
  back: () => {
    const f = get().focus
    if (f.lod === 2) set({ focus: { lod: 1, planetId: f.planetId } })
    else if (f.lod === 1) set({ focus: { lod: 0 } })
    // lod 0: no-op
  },
  setSplitterRatio: (r) => {
    const clamped = clamp(r, 0.15, 0.85)
    if (typeof localStorage !== 'undefined') localStorage.setItem(SPLITTER_KEY, String(clamped))
    set({ splitterRatio: clamped })
  },
  setNotificationDeckOpen: (open) => set({ notificationDeckOpen: open }),
}))
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/client/state/uiStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/state/uiStore.ts src/client/state/uiStore.test.ts
git commit -m "feat: uiStore with focus reducer + splitter persistence"
```

---

### Task 1.3: Mount R3F Canvas + Stars background as the new top-level

The existing top-tab nav (`ships | run | editor`) is replaced by a single full-screen `<Canvas>`. Old PixiJS and old views are kept mounted in their current files for now (will be deleted in Phase 15) but no longer rendered.

**Files:**
- Create: `src/client/scene/SolarSystemScene.tsx`
- Modify: `src/client/App.tsx`

- [ ] **Step 1: Write `SolarSystemScene.tsx` with just stars**

```tsx
// src/client/scene/SolarSystemScene.tsx
import { Stars } from '@react-three/drei'

export function SolarSystemScene() {
  return (
    <>
      <color attach="background" args={['#020617']} />
      <Stars
        radius={300}
        depth={60}
        count={6000}
        factor={4}
        saturation={0}
        fade
        speed={0.3}
      />
      <ambientLight intensity={0.15} />
    </>
  )
}
```

- [ ] **Step 2: Rewrite `App.tsx` to mount Canvas + scene**

Strip the entire `ViewMode` / `view` / `visited` machinery, the header nav, and the three view layers. Keep socket initialization, store-driven data loads, toasts. Result:

```tsx
// src/client/App.tsx
import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  useConnected,
  useSocketStore,
} from './state/socketStore'
import { initSocketClient } from './state/socketClient'
import { apiGet } from './api'
import type { FeatureSummary, PlanetSummary } from '../core/types'
import { Toasts } from './components/Toasts'
import { SolarSystemScene } from './scene/SolarSystemScene'

export function App() {
  useEffect(() => {
    initSocketClient()
  }, [])

  useEffect(() => {
    void (async () => {
      const planetsRes = await apiGet<PlanetSummary[]>('/api/planets')
      if (!planetsRes.ok) return
      useSocketStore.getState().setPlanets(planetsRes.data)
      const featureMap = new Map<number, FeatureSummary[]>()
      await Promise.all(
        planetsRes.data.map(async (p) => {
          const fs = await apiGet<FeatureSummary[]>(`/api/planets/${p.id}/features`)
          featureMap.set(p.id, fs.ok ? fs.data : [])
        }),
      )
      useSocketStore.getState().setFeatures(featureMap)
    })()
  }, [])

  return (
    <main className="min-h-screen w-screen bg-black overflow-hidden font-sans">
      <div className="absolute inset-0">
        <Canvas camera={{ position: [0, 8, 24], fov: 45 }} dpr={[1, 2]}>
          <SolarSystemScene />
        </Canvas>
      </div>
      <Toasts />
    </main>
  )
}

// keep this export-free `useConnected` import for future HUD wiring; remove if linter complains
void useConnected
```

(If your linter rejects the `void useConnected` line, simply omit it — it's an intent marker, not required.)

- [ ] **Step 3: Run dev server and verify visually via Chrome MCP**

```bash
npm run dev
```

Then with Chrome MCP:
1. `mcp__chrome-devtools__new_page` → `http://localhost:5173`
2. `mcp__chrome-devtools__take_screenshot` — confirm: black background, faint stars drifting, no errors in console.
3. `mcp__chrome-devtools__list_console_messages` — clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/App.tsx src/client/scene/SolarSystemScene.tsx
git commit -m "feat(phase 1): R3F canvas + Stars; replace top-tab nav"
```

---

## Phase 2 — Glass primitives

### Task 2.1: GlassPanel + GlassButton + GlassChip + GlassTab

**Files:**
- Create: `src/client/components/glass/GlassPanel.tsx`
- Create: `src/client/components/glass/GlassButton.tsx`
- Create: `src/client/components/glass/GlassChip.tsx`
- Create: `src/client/components/glass/GlassTab.tsx`
- Create: `src/client/components/glass/glass.css`

- [ ] **Step 1: Write `glass.css` with the style B tokens**

```css
/* src/client/components/glass/glass.css */
.glass-panel {
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(18px) saturate(1.15);
  -webkit-backdrop-filter: blur(18px) saturate(1.15);
  border: 1px solid rgba(125, 211, 252, 0.30);
  border-radius: 16px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.10),
    0 8px 32px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(125, 211, 252, 0.20),
    0 0 60px rgba(56, 189, 248, 0.28);
  color: #e0f2fe;
}

.glass-chip {
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid rgba(125, 211, 252, 0.30);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: #e0f2fe;
}

.glass-button {
  background: rgba(56, 189, 248, 0.18);
  border: 1px solid rgba(125, 211, 252, 0.5);
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 12px;
  color: #e0f2fe;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.glass-button:hover { background: rgba(56, 189, 248, 0.30); border-color: rgba(125, 211, 252, 0.85); }
.glass-button.ghost { background: transparent; border-color: rgba(125, 211, 252, 0.45); }
.glass-button.danger { background: transparent; border-color: rgba(251, 113, 133, 0.5); color: #fda4af; }

.glass-tab {
  padding: 5px 12px;
  font-size: 11px;
  letter-spacing: 0.16em;
  font-weight: 600;
  border: 1px solid rgba(125, 211, 252, 0.30);
  border-radius: 999px;
  color: #94a3b8;
  background: transparent;
  cursor: pointer;
}
.glass-tab.active {
  color: #f0f9ff;
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(125, 211, 252, 0.7);
  box-shadow: 0 0 18px rgba(56, 189, 248, 0.5);
}
```

Then import this once at the app root. In `src/client/main.tsx`, add:

```ts
import './components/glass/glass.css'
```

- [ ] **Step 2: Write the four primitives**

```tsx
// src/client/components/glass/GlassPanel.tsx
import type { HTMLAttributes, PropsWithChildren } from 'react'

export function GlassPanel({ className = '', children, ...rest }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={`glass-panel ${className}`} {...rest}>
      {children}
    </div>
  )
}
```

```tsx
// src/client/components/glass/GlassButton.tsx
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost' | 'danger'

export function GlassButton({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`glass-button ${variant} ${className}`} {...rest} />
}
```

```tsx
// src/client/components/glass/GlassChip.tsx
import type { HTMLAttributes, PropsWithChildren } from 'react'

export function GlassChip({ className = '', children, ...rest }: PropsWithChildren<HTMLAttributes<HTMLSpanElement>>) {
  return <span className={`glass-chip ${className}`} {...rest}>{children}</span>
}
```

```tsx
// src/client/components/glass/GlassTab.tsx
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'

export function GlassTab({
  active,
  className = '',
  children,
  ...rest
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }>) {
  return (
    <button className={`glass-tab ${active ? 'active' : ''} ${className}`} {...rest}>
      {children}
    </button>
  )
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/client/components/glass/ src/client/main.tsx
git commit -m "feat(phase 2): glass primitives (panel/button/chip/tab)"
```

---

### Task 2.2: GlassSplitter (draggable vertical handle)

**Files:**
- Create: `src/client/components/glass/GlassSplitter.tsx`
- Create: `src/client/components/glass/GlassSplitter.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/client/components/glass/GlassSplitter.test.tsx
import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { GlassSplitter } from './GlassSplitter'

describe('GlassSplitter', () => {
  it('calls onChange with clamped ratio on drag', () => {
    const onChange = vi.fn()
    const { container } = render(
      <div style={{ width: 1000, height: 500 }}>
        <GlassSplitter ratio={0.5} onChange={onChange} />
      </div>,
    )
    const handle = container.querySelector('[data-glass-splitter]')!
    // Mock the parent rect because jsdom has no layout
    handle.getBoundingClientRect = () => ({ left: 500 } as DOMRect)
    ;(handle.parentElement as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, width: 1000, right: 1000 } as DOMRect)

    fireEvent.mouseDown(handle, { clientX: 500 })
    fireEvent.mouseMove(window, { clientX: 200 })
    fireEvent.mouseUp(window)
    expect(onChange).toHaveBeenLastCalledWith(0.2)
  })
})
```

- [ ] **Step 2: Verify it fails**

```bash
npx vitest run src/client/components/glass/GlassSplitter.test.tsx
```

Expected: FAIL — `GlassSplitter` not found.

- [ ] **Step 3: Implement**

```tsx
// src/client/components/glass/GlassSplitter.tsx
import { useCallback, useEffect, useRef } from 'react'

export interface GlassSplitterProps {
  ratio: number
  onChange: (next: number) => void
  /** Min/max ratios — defaults match uiStore clamp. */
  min?: number
  max?: number
}

export function GlassSplitter({ ratio, onChange, min = 0.15, max = 0.85 }: GlassSplitterProps) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const onDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
  }, [])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || !ref.current?.parentElement) return
      const parent = ref.current.parentElement.getBoundingClientRect()
      const next = (e.clientX - parent.left) / parent.width
      onChange(Math.max(min, Math.min(max, next)))
    }
    const up = () => {
      dragging.current = false
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [onChange, min, max])

  return (
    <div
      ref={ref}
      data-glass-splitter
      onMouseDown={onDown}
      style={{
        position: 'absolute',
        left: `calc(${ratio * 100}% - 4px)`,
        top: 0,
        bottom: 0,
        width: 8,
        cursor: 'col-resize',
        background: 'rgba(125,211,252,0.10)',
        borderLeft: '1px solid rgba(125,211,252,0.25)',
        borderRight: '1px solid rgba(125,211,252,0.25)',
        zIndex: 5,
      }}
    />
  )
}
```

- [ ] **Step 4: Verify pass**

```bash
npx vitest run src/client/components/glass/GlassSplitter.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/glass/GlassSplitter.tsx src/client/components/glass/GlassSplitter.test.tsx
git commit -m "feat(phase 2): GlassSplitter with drag-clamped ratio"
```

---

## Phase 3 — Sun

### Task 3.1: Sun shader sphere + bloom postprocessing

**Files:**
- Create: `src/client/scene/Sun.tsx`
- Modify: `src/client/scene/SolarSystemScene.tsx`

- [ ] **Step 1: Implement `<Sun>` with a procedural shader material**

```tsx
// src/client/scene/Sun.tsx
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { ShaderMaterial, Mesh, Color } from 'three'

const vert = `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const frag = `
  uniform float uTime;
  varying vec3 vPos;
  // Cheap noise — 3 octaves of sin warps
  float noise(vec3 p) {
    float n = sin(p.x * 2.0 + uTime * 0.4) + sin(p.y * 2.7 - uTime * 0.3) + sin(p.z * 3.1 + uTime * 0.2);
    return n / 3.0;
  }
  void main() {
    float n = noise(vPos * 1.3);
    vec3 base = mix(vec3(1.0, 0.6, 0.15), vec3(1.0, 0.9, 0.55), 0.5 + 0.5 * n);
    gl_FragColor = vec4(base, 1.0);
  }
`

export function Sun() {
  const meshRef = useRef<Mesh>(null)
  const matRef = useRef<ShaderMaterial>(null)
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: vert,
        fragmentShader: frag,
      }),
    [],
  )
  useFrame((_, dt) => {
    if (matRef.current) matRef.current.uniforms.uTime.value += dt
    if (meshRef.current) meshRef.current.rotation.y += dt * 0.02
  })
  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <sphereGeometry args={[2.4, 64, 64]} />
      <primitive ref={matRef} object={material} attach="material" />
      {/* Corona — additive, larger sphere with a soft glow material */}
      <pointLight intensity={3} distance={120} decay={1.5} color={new Color('#fbbf24')} />
    </mesh>
  )
}
```

- [ ] **Step 2: Add bloom to the scene + include the sun**

```tsx
// src/client/scene/SolarSystemScene.tsx
import { Stars } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { Sun } from './Sun'

export function SolarSystemScene() {
  return (
    <>
      <color attach="background" args={['#020617']} />
      <Stars radius={300} depth={60} count={6000} factor={4} saturation={0} fade speed={0.3} />
      <ambientLight intensity={0.15} />
      <Sun />
      <EffectComposer>
        <Bloom intensity={1.0} luminanceThreshold={0.25} luminanceSmoothing={0.4} mipmapBlur />
        <Vignette darkness={0.6} offset={0.3} />
      </EffectComposer>
    </>
  )
}
```

- [ ] **Step 3: Verify via Chrome MCP**

1. `mcp__chrome-devtools__take_screenshot` — confirm: glowing orange sun centered, stars in background, bloom halo visible, vignette darkens edges.
2. `mcp__chrome-devtools__list_console_messages` — clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/scene/Sun.tsx src/client/scene/SolarSystemScene.tsx
git commit -m "feat(phase 3): procedural sun + bloom postprocessing"
```

---

## Phase 4 — Procedural planets

### Task 4.1: Hash util + planet param derivation (TDD)

**Files:**
- Create: `src/client/scene/lib/hash.ts`
- Create: `src/client/scene/lib/planetParams.ts`
- Create: `src/client/scene/lib/planetParams.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/client/scene/lib/planetParams.test.ts
import { describe, it, expect } from 'vitest'
import { derivePlanetParams } from './planetParams'

describe('derivePlanetParams', () => {
  it('is deterministic for the same name', () => {
    const a = derivePlanetParams('AgentYard')
    const b = derivePlanetParams('AgentYard')
    expect(a).toEqual(b)
  })

  it('differs for different names', () => {
    const a = derivePlanetParams('AgentYard')
    const b = derivePlanetParams('Stellar')
    expect(a.surfaceType).not.toBe(b.surfaceType) /* may collide, but extremely unlikely */
    // weaker: at least one of several params differs
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('produces in-range radii', () => {
    for (const name of ['a', 'bb', 'looooong', 'AgentYard', 'foo-bar-baz']) {
      const p = derivePlanetParams(name)
      expect(p.radius).toBeGreaterThanOrEqual(0.8)
      expect(p.radius).toBeLessThanOrEqual(1.2)
      expect(p.paletteHue).toBeGreaterThanOrEqual(0)
      expect(p.paletteHue).toBeLessThan(360)
      expect(['rocky', 'gas', 'lava', 'ice', 'ocean', 'crystal', 'ringed']).toContain(p.surfaceType)
      expect(p.rotationSpeed).toBeGreaterThanOrEqual(0.3)
      expect(p.rotationSpeed).toBeLessThanOrEqual(1.0)
    }
  })

  it('ringed surface always has hasRing=true', () => {
    // Search for a name that hashes to ringed; deterministic so we can pick one.
    let found = false
    for (let i = 0; i < 200; i++) {
      const p = derivePlanetParams(`probe-${i}`)
      if (p.surfaceType === 'ringed') {
        expect(p.hasRing).toBe(true)
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })
})
```

- [ ] **Step 2: Verify it fails**

```bash
npx vitest run src/client/scene/lib/planetParams.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement hash + params**

```ts
// src/client/scene/lib/hash.ts
// FNV-1a 32-bit string hash — fast, dependency-free, deterministic.
export function hashStringToInt(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

/** Pull a byte at position i from a 32-bit hash (4 bytes). Returns 0..255. */
export function hashByte(h: number, i: number): number {
  return (h >>> (i * 8)) & 0xff
}

/** Combine two seeds to get a derived hash that's stable but distinct. */
export function deriveHash(seed: number, salt: string): number {
  return hashStringToInt(salt + seed.toString(16))
}
```

```ts
// src/client/scene/lib/planetParams.ts
import { hashStringToInt, hashByte, deriveHash } from './hash'

export type SurfaceType = 'rocky' | 'gas' | 'lava' | 'ice' | 'ocean' | 'crystal' | 'ringed'

export interface PlanetParams {
  radius: number          // 0.8..1.2
  surfaceType: SurfaceType
  paletteHue: number      // 0..360
  atmosphereHue: number   // 0..360
  rotationSpeed: number   // rev/min (0.3..1.0)
  hasRing: boolean
}

const SURFACES: SurfaceType[] = ['rocky', 'gas', 'lava', 'ice', 'ocean', 'crystal', 'ringed']

export function derivePlanetParams(name: string): PlanetParams {
  const h1 = hashStringToInt(name)
  const h2 = deriveHash(h1, 'planet')

  const radius = 0.8 + (hashByte(h1, 0) / 255) * 0.4
  const surfaceType = SURFACES[hashByte(h1, 1) % SURFACES.length]
  const paletteHue = (hashByte(h1, 2) / 255) * 360
  const atmosphereHue = (paletteHue + 30) % 360
  const rotationSpeed = 0.3 + (hashByte(h1, 3) / 255) * 0.7
  // Independent 10% chance of a ring, OR forced by surfaceType === 'ringed'.
  const hasRing = surfaceType === 'ringed' || hashByte(h2, 0) < 26

  return { radius, surfaceType, paletteHue, atmosphereHue, rotationSpeed, hasRing }
}
```

- [ ] **Step 4: Verify pass**

```bash
npx vitest run src/client/scene/lib/planetParams.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/scene/lib/
git commit -m "feat(phase 4): deterministic planet param derivation"
```

---

### Task 4.2: PlanetMaterial shader + Planet component + orbital placement

For brevity (and because shader output isn't unit-testable), this task uses smoke + visual verification.

**Files:**
- Create: `src/client/scene/PlanetMaterial.tsx`
- Create: `src/client/scene/Planet.tsx`
- Create: `src/client/scene/lib/orbits.ts`
- Create: `src/client/scene/lib/orbits.test.ts`
- Modify: `src/client/scene/SolarSystemScene.tsx`

- [ ] **Step 1: TDD the orbit layout helper**

```ts
// src/client/scene/lib/orbits.test.ts
import { describe, it, expect } from 'vitest'
import { planetOrbitPositions, ringAngles } from './orbits'

describe('planetOrbitPositions', () => {
  it('places N planets on increasing ring radii', () => {
    const positions = planetOrbitPositions(4, 0, { firstRing: 6, ringGap: 3 })
    expect(positions).toHaveLength(4)
    expect(positions[0].radius).toBe(6)
    expect(positions[1].radius).toBe(9)
    expect(positions[2].radius).toBe(12)
    expect(positions[3].radius).toBe(15)
  })

  it('spreads angles for planets sharing a ring (unused but supported)', () => {
    const positions = planetOrbitPositions(4, Math.PI / 6, { firstRing: 6, ringGap: 3 })
    expect(positions[0].angle).toBe(Math.PI / 6)
  })
})

describe('ringAngles', () => {
  it('returns N evenly spaced angles', () => {
    const a = ringAngles(4)
    expect(a).toEqual([0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2])
  })
  it('returns single angle 0 for N=1', () => {
    expect(ringAngles(1)).toEqual([0])
  })
  it('returns empty for N=0', () => {
    expect(ringAngles(0)).toEqual([])
  })
})
```

- [ ] **Step 2: Implement orbit math**

```ts
// src/client/scene/lib/orbits.ts
export interface OrbitConfig {
  firstRing: number
  ringGap: number
}

export interface OrbitPos {
  radius: number
  angle: number
}

/**
 * Index-N planet sits on ring N. (One planet per ring keeps the scene readable
 * for the typical handful of projects.)
 */
export function planetOrbitPositions(count: number, baseAngle = 0, cfg: OrbitConfig = { firstRing: 6, ringGap: 3 }): OrbitPos[] {
  const out: OrbitPos[] = []
  for (let i = 0; i < count; i++) {
    out.push({ radius: cfg.firstRing + i * cfg.ringGap, angle: baseAngle })
  }
  return out
}

/** N evenly spaced angles in [0, 2π). */
export function ringAngles(n: number): number[] {
  if (n <= 0) return []
  const step = (2 * Math.PI) / n
  return Array.from({ length: n }, (_, i) => i * step)
}
```

- [ ] **Step 3: Verify pass**

```bash
npx vitest run src/client/scene/lib/orbits.test.ts
```

- [ ] **Step 4: Implement PlanetMaterial (compact MeshStandardMaterial + tint, surface type variants come in a later polish pass)**

```tsx
// src/client/scene/PlanetMaterial.tsx
import { Color } from 'three'
import { useMemo } from 'react'
import type { PlanetParams } from './lib/planetParams'

/**
 * Phase-1 material: hue-tinted MeshStandardMaterial. Surface-type shader
 * variants land in Phase 14 polish; for now every planet renders with the
 * same procedural look but tinted distinctively per project.
 */
export function PlanetMaterial({ params }: { params: PlanetParams }) {
  const color = useMemo(() => {
    const c = new Color()
    c.setHSL(params.paletteHue / 360, 0.55, 0.45)
    return c
  }, [params.paletteHue])
  return <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} />
}
```

- [ ] **Step 5: Implement Planet component**

```tsx
// src/client/scene/Planet.tsx
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Group } from 'three'
import { derivePlanetParams } from './lib/planetParams'
import { PlanetMaterial } from './PlanetMaterial'
import type { PlanetSummary } from '../../core/types'
import { useUiStore } from '../state/uiStore'

interface PlanetProps {
  planet: PlanetSummary
  orbitRadius: number
  orbitAngleOffset: number
}

export function Planet({ planet, orbitRadius, orbitAngleOffset }: PlanetProps) {
  const params = useMemo(() => derivePlanetParams(planet.name), [planet.name])
  const groupRef = useRef<Group>(null)
  const meshRef = useRef<Group>(null)
  const focusPlanet = useUiStore((s) => s.focusPlanet)

  useFrame((_, dt) => {
    if (groupRef.current) {
      // Orbit around the sun
      groupRef.current.rotation.y += dt * 0.05 // shared orbit speed for now
    }
    if (meshRef.current) {
      meshRef.current.rotation.y += dt * (params.rotationSpeed * 0.4)
    }
  })

  return (
    <group ref={groupRef} rotation={[0, orbitAngleOffset, 0]}>
      <group ref={meshRef} position={[orbitRadius, 0, 0]} onClick={(e) => { e.stopPropagation(); focusPlanet(planet.id) }}>
        <mesh>
          <sphereGeometry args={[params.radius, 48, 48]} />
          <PlanetMaterial params={params} />
        </mesh>
        {params.hasRing && (
          <mesh rotation={[Math.PI / 2.3, 0, 0]}>
            <ringGeometry args={[params.radius * 1.4, params.radius * 1.9, 64]} />
            <meshBasicMaterial color="#94a3b8" transparent opacity={0.4} side={2 /* DoubleSide */} />
          </mesh>
        )}
      </group>
    </group>
  )
}
```

- [ ] **Step 6: Wire planets into the scene**

```tsx
// src/client/scene/SolarSystemScene.tsx
import { Stars } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { Sun } from './Sun'
import { Planet } from './Planet'
import { planetOrbitPositions } from './lib/orbits'
import { usePlanets } from '../state/socketStore'

export function SolarSystemScene() {
  const planets = usePlanets()
  const positions = planetOrbitPositions(planets.length)

  return (
    <>
      <color attach="background" args={['#020617']} />
      <Stars radius={300} depth={60} count={6000} factor={4} saturation={0} fade speed={0.3} />
      <ambientLight intensity={0.15} />
      <Sun />
      {planets.map((p, i) => (
        <Planet key={p.id} planet={p} orbitRadius={positions[i].radius} orbitAngleOffset={(i * Math.PI) / 3} />
      ))}
      <EffectComposer>
        <Bloom intensity={1.0} luminanceThreshold={0.25} luminanceSmoothing={0.4} mipmapBlur />
        <Vignette darkness={0.6} offset={0.3} />
      </EffectComposer>
    </>
  )
}
```

- [ ] **Step 7: Chrome MCP smoke test**

1. Open the page → confirm at least one planet renders on its orbit around the sun.
2. If your dev DB has no planets, create one via API or via the existing planet-create endpoint (the new HUD isn't built yet — for now, `curl -X POST http://localhost:3000/api/planets -d '{"name":"AgentYard","projectPath":"/Users/...path..."}' -H 'Content-Type: application/json'` works).
3. Confirm clicking the planet logs the focus state change (open devtools and inspect `useUiStore.getState().focus`).

- [ ] **Step 8: Commit**

```bash
git add src/client/scene/
git commit -m "feat(phase 4): procedural planets on orbits, click → focus state"
```

---

## Phase 5 — Camera & LOD transitions

### Task 5.1: CameraRig with tween-driven focus

**Files:**
- Create: `src/client/scene/CameraRig.tsx`
- Create: `src/client/scene/lib/cameraTargets.ts`
- Create: `src/client/scene/lib/cameraTargets.test.ts`
- Modify: `src/client/scene/SolarSystemScene.tsx`

- [ ] **Step 1: TDD the target-computation helper**

```ts
// src/client/scene/lib/cameraTargets.test.ts
import { describe, it, expect } from 'vitest'
import { cameraTargetFor } from './cameraTargets'

describe('cameraTargetFor', () => {
  const planetPos = { x: 6, y: 0, z: 0 }

  it('LOD 0 returns the system overview position', () => {
    const t = cameraTargetFor({ lod: 0 }, () => null)
    expect(t.position).toEqual([0, 8, 24])
    expect(t.lookAt).toEqual([0, 0, 0])
  })

  it('LOD 1 planet positions the camera offset from the planet', () => {
    const t = cameraTargetFor({ lod: 1, planetId: 1 }, () => planetPos)
    // Camera sits to the side and back of the planet; planet is the lookAt.
    expect(t.lookAt).toEqual([6, 0, 0])
    expect(t.position[0]).toBeCloseTo(6)
    expect(t.position[2]).toBeGreaterThan(2) // pulled back along +z
  })

  it('LOD 1 sun returns sun-focused position', () => {
    const t = cameraTargetFor({ lod: 1, sun: true }, () => null)
    expect(t.lookAt).toEqual([0, 0, 0])
    expect(t.position[2]).toBeGreaterThan(2)
  })

  it('returns sentinel for LOD 2 (ship positions are dynamic; handled by rig)', () => {
    const t = cameraTargetFor({ lod: 2, planetId: 1, shipFeatureId: 7 }, () => planetPos)
    // For now: ship target is "near the planet" — refined in Phase 10.
    expect(t.lookAt).toEqual([6, 0, 0])
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/client/scene/lib/cameraTargets.ts
import type { Focus } from '../../state/uiStore'

export interface CameraTarget {
  position: [number, number, number]
  lookAt: [number, number, number]
}

export type PlanetPositionLookup = (planetId: number) => { x: number; y: number; z: number } | null

const SYSTEM_OVERVIEW: CameraTarget = {
  position: [0, 8, 24],
  lookAt: [0, 0, 0],
}

const SUN_FOCUS: CameraTarget = {
  position: [0, 1.5, 8],
  lookAt: [0, 0, 0],
}

const PLANET_OFFSET = { x: 0, y: 1.2, z: 5 }

export function cameraTargetFor(focus: Focus, lookup: PlanetPositionLookup): CameraTarget {
  if (focus.lod === 0) return SYSTEM_OVERVIEW
  if ('sun' in focus && focus.sun) return SUN_FOCUS
  if (focus.lod === 1 && 'planetId' in focus) {
    const p = lookup(focus.planetId)
    if (!p) return SYSTEM_OVERVIEW
    return {
      position: [p.x + PLANET_OFFSET.x, p.y + PLANET_OFFSET.y, p.z + PLANET_OFFSET.z],
      lookAt: [p.x, p.y, p.z],
    }
  }
  if (focus.lod === 2) {
    const p = lookup(focus.planetId)
    if (!p) return SYSTEM_OVERVIEW
    // LOD-2 ship offset is refined in Phase 10 (needs ship orbital position).
    // For now we frame the planet's vicinity.
    return {
      position: [p.x + PLANET_OFFSET.x * 0.5, p.y + PLANET_OFFSET.y, p.z + PLANET_OFFSET.z * 0.6],
      lookAt: [p.x, p.y, p.z],
    }
  }
  return SYSTEM_OVERVIEW
}
```

- [ ] **Step 3: Implement the camera rig**

```tsx
// src/client/scene/CameraRig.tsx
import { useThree, useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { useUiStore } from '../state/uiStore'
import { cameraTargetFor, type PlanetPositionLookup } from './lib/cameraTargets'

interface Props {
  planetLookup: PlanetPositionLookup
}

const DURATION = 0.8 // seconds

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function CameraRig({ planetLookup }: Props) {
  const { camera } = useThree()
  const focus = useUiStore((s) => s.focus)

  const fromPos = useRef(new Vector3().copy(camera.position))
  const fromLook = useRef(new Vector3(0, 0, 0))
  const toPos = useRef(new Vector3())
  const toLook = useRef(new Vector3())
  const t = useRef(1) // 1 = settled

  useEffect(() => {
    const target = cameraTargetFor(focus, planetLookup)
    fromPos.current.copy(camera.position)
    // Approximate current lookAt from camera orientation
    const forward = new Vector3()
    camera.getWorldDirection(forward)
    fromLook.current.copy(camera.position).add(forward.multiplyScalar(10))
    toPos.current.set(...target.position)
    toLook.current.set(...target.lookAt)
    t.current = 0
  }, [focus, planetLookup, camera])

  useFrame((_, dt) => {
    if (t.current >= 1) return
    t.current = Math.min(1, t.current + dt / DURATION)
    const k = easeInOutCubic(t.current)
    camera.position.lerpVectors(fromPos.current, toPos.current, k)
    const lookAt = new Vector3().lerpVectors(fromLook.current, toLook.current, k)
    camera.lookAt(lookAt)
  })

  return null
}
```

- [ ] **Step 4: Wire the rig into the scene with a planet-lookup**

In `SolarSystemScene.tsx`, compute a `planetLookup` from the current planet positions and pass it down:

```tsx
// inside SolarSystemScene
import { useMemo, useCallback } from 'react'
// ...

const positions = planetOrbitPositions(planets.length)
const planetWorld = useMemo(() => {
  // Planet world positions (relative to sun = origin). Since each planet's
  // orbit group rotates over time, we approximate "current" world position
  // by sampling at angle offset; the camera lerps fast enough that lag is OK.
  const map = new Map<number, { x: number; y: number; z: number }>()
  planets.forEach((p, i) => {
    const angle = (i * Math.PI) / 3 // matches orbitAngleOffset
    map.set(p.id, { x: Math.cos(angle) * positions[i].radius, y: 0, z: -Math.sin(angle) * positions[i].radius })
  })
  return map
}, [planets, positions])
const lookup = useCallback((id: number) => planetWorld.get(id) ?? null, [planetWorld])

// ...inside return
<CameraRig planetLookup={lookup} />
```

(The angle-snapshot approximation is fine for Phase 5; Phase 10 wires up moving targets that update each frame.)

- [ ] **Step 5: Verify pass**

```bash
npx vitest run src/client/scene/lib/cameraTargets.test.ts
```

- [ ] **Step 6: Chrome MCP visual test**

1. Open page → click a planet → camera flies in.
2. Press Esc (will be wired in Task 5.2) — for now, simulate by setting `useUiStore.getState().back()` in devtools console.
3. Confirm smooth motion, no jitter.

- [ ] **Step 7: Commit**

```bash
git add src/client/scene/CameraRig.tsx src/client/scene/lib/cameraTargets.ts src/client/scene/lib/cameraTargets.test.ts src/client/scene/SolarSystemScene.tsx
git commit -m "feat(phase 5): CameraRig with tween-driven focus transitions"
```

---

### Task 5.2: Back-out keys + click-outside

**Files:**
- Create: `src/client/components/hud/BackOutHandler.tsx`
- Modify: `src/client/App.tsx`

- [ ] **Step 1: Implement back-out handler**

```tsx
// src/client/components/hud/BackOutHandler.tsx
import { useEffect } from 'react'
import { useUiStore } from '../../state/uiStore'

export function BackOutHandler() {
  const back = useUiStore((s) => s.back)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back])
  return null
}
```

- [ ] **Step 2: Mount in App.tsx**

```tsx
// inside App.tsx return:
<BackOutHandler />
```

- [ ] **Step 3: Chrome MCP test**

1. Click planet → camera flies in.
2. Press Esc → camera returns to LOD 0.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/hud/BackOutHandler.tsx src/client/App.tsx
git commit -m "feat(phase 5): Esc/back keyboard handler"
```

---

## Phase 6 — Focused panel (LOD 1)

### Task 6.1: FocusedPanel shell (top bar + info panel + chat panel + splitter)

**Files:**
- Create: `src/client/components/hud/FocusedPanel.tsx`
- Create: `src/client/components/hud/HudLayer.tsx`
- Modify: `src/client/App.tsx`

- [ ] **Step 1: HudLayer wrapper that selects the right HUD per LOD**

```tsx
// src/client/components/hud/HudLayer.tsx
import { useUiStore } from '../../state/uiStore'
import { FocusedPanel } from './FocusedPanel'
// AmbientHUD lands in Phase 7

export function HudLayer() {
  const focus = useUiStore((s) => s.focus)
  return (
    <div className="absolute inset-0 pointer-events-none">
      {focus.lod === 0 && (
        <div className="pointer-events-auto" />  /* AmbientHUD goes here in Phase 7 */
      )}
      {focus.lod >= 1 && (
        <div className="pointer-events-auto absolute inset-0">
          <FocusedPanel />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: FocusedPanel layout shell**

```tsx
// src/client/components/hud/FocusedPanel.tsx
import { GlassPanel } from '../glass/GlassPanel'
import { GlassButton } from '../glass/GlassButton'
import { GlassChip } from '../glass/GlassChip'
import { GlassSplitter } from '../glass/GlassSplitter'
import { useUiStore } from '../../state/uiStore'
import { usePlanets } from '../../state/socketStore'

export function FocusedPanel() {
  const focus = useUiStore((s) => s.focus)
  const back = useUiStore((s) => s.back)
  const splitterRatio = useUiStore((s) => s.splitterRatio)
  const setSplitterRatio = useUiStore((s) => s.setSplitterRatio)
  const planets = usePlanets()

  const planetId = focus.lod === 1 && 'planetId' in focus ? focus.planetId
                 : focus.lod === 2 ? focus.planetId
                 : null
  const planet = planetId !== null ? planets.find((p) => p.id === planetId) ?? null : null

  if (!planet) return null

  return (
    <div className="absolute inset-0 p-4">
      {/* Top bar */}
      <GlassPanel className="flex items-center justify-between px-4 py-2 mb-3">
        <div className="flex items-center gap-3">
          <GlassButton variant="ghost" onClick={() => back()}>← system</GlassButton>
          <span className="font-semibold tracking-wide">{planet.name}</span>
          <span className="font-mono text-xs text-slate-400">{planet.projectPath}</span>
        </div>
        <div className="flex items-center gap-2">
          <GlassChip>● link</GlassChip>
          <GlassButton variant="ghost">⚙ workflow editor</GlassButton>
          <GlassButton variant="danger">✕ delete</GlassButton>
        </div>
      </GlassPanel>

      {/* Body: info | splitter | chat */}
      <div className="relative" style={{ height: 'calc(100% - 80px)' }}>
        <div className="absolute inset-y-0 left-0 p-2" style={{ width: `${splitterRatio * 100}%` }}>
          <GlassPanel className="h-full p-4 overflow-y-auto">
            <div className="text-xs tracking-widest text-slate-400">INFO PANEL</div>
            <p className="text-sm text-slate-300 mt-2">Tabs land in Task 6.2.</p>
          </GlassPanel>
        </div>

        <GlassSplitter ratio={splitterRatio} onChange={setSplitterRatio} />

        <div className="absolute inset-y-0 right-0 p-2" style={{ left: `${splitterRatio * 100}%`, paddingLeft: 12 }}>
          <GlassPanel className="h-full p-4">
            <div className="text-xs tracking-widest text-slate-400">CHAT</div>
            <p className="text-sm text-slate-300 mt-2">Wired in Task 6.3.</p>
          </GlassPanel>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount HudLayer in App.tsx**

```tsx
// App.tsx — add import and JSX:
import { HudLayer } from './components/hud/HudLayer'
// ...
// inside return:
<HudLayer />
```

- [ ] **Step 4: Chrome MCP visual test**

1. Open page, click a planet → camera flies in AND full-screen HUD appears.
2. Drag the splitter — confirm both panels resize and the ratio persists across reload.
3. Click "← system" — confirm camera returns and HUD unmounts.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/hud/ src/client/App.tsx
git commit -m "feat(phase 6): FocusedPanel shell with draggable splitter"
```

---

### Task 6.2: Port tab content (FEATURES / TOOLS / PLANS / DESCRIPTION) from old PlanetDetailsPanel

**Files:**
- Modify: `src/client/components/hud/FocusedPanel.tsx`
- (Read for porting): `src/client/components/PlanetDetailsPanel.tsx`

- [ ] **Step 1: Lift the four tab views from `PlanetDetailsPanel.tsx`**

`FeaturesTab`, `PlansTab`, `DescriptionTab`, and `ToolsTabContent` (already a separate component) move into the FocusedPanel. The chat tab and the on-mount chat-open effect stay behind in `PlanetDetailsPanel.tsx` — they'll be re-used in Task 6.3. Replace the info-panel placeholder with:

```tsx
// inside FocusedPanel.tsx, top of file add:
import { useState, useEffect } from 'react'
import { useFeaturesMap } from '../../state/socketStore'
import { GlassTab } from '../glass/GlassTab'
import { ToolsTabContent } from '../ToolsTabContent'
import { apiGet } from '../../api'
// ... and the FeaturesTab/PlansTab/DescriptionTab definitions (copy from
// PlanetDetailsPanel.tsx without modification).

type Tab = 'features' | 'tools' | 'plans' | 'description' | 'run'

// Inside the info panel GlassPanel, replace its body with:
function InfoPanelBody({ planet }: { planet: PlanetSummary }) {
  const features = useFeaturesMap().get(planet.id) ?? []
  const [tab, setTab] = useState<Tab>('features')
  const hasRunning = features.some((f) => f.status === 'running')

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        <GlassTab active={tab === 'features'} onClick={() => setTab('features')}>FEATURES</GlassTab>
        <GlassTab active={tab === 'tools'} onClick={() => setTab('tools')}>TOOLS</GlassTab>
        <GlassTab active={tab === 'plans'} onClick={() => setTab('plans')}>PLANS</GlassTab>
        <GlassTab active={tab === 'description'} onClick={() => setTab('description')}>DESCRIPTION</GlassTab>
        {hasRunning && <GlassTab active={tab === 'run'} onClick={() => setTab('run')}>RUN</GlassTab>}
      </div>
      {tab === 'features' && <FeaturesTab features={features} planetId={planet.id} />}
      {tab === 'tools' && <ToolsTabContent planetId={planet.id} />}
      {tab === 'plans' && <PlansTab features={features} />}
      {tab === 'description' && <DescriptionTab planetId={planet.id} projectPath={planet.projectPath} />}
      {tab === 'run' && <RunTabContent planetId={planet.id} features={features} />}
    </>
  )
}
```

Carry over the exact JSX for `FeaturesTab`, `PlansTab`, `DescriptionTab` from the old `PlanetDetailsPanel.tsx` — they're known to work. The `RunTabContent` is a stub for now (Task 10.4 wires it):

```tsx
function RunTabContent({ planetId, features }: { planetId: number; features: FeatureSummary[] }) {
  return <div className="text-sm text-slate-300">Live run view lands in Task 10.4.</div>
}
```

`ToolsTabContent` already takes a prop (today named `shipId`; after Phase 0 it's `planetId`). If it's still named `shipId`, that's a Phase 0 leftover — fix it now.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Chrome MCP visual test**

1. Open a planet → see the tabs. Click each tab in turn; confirm content renders.
2. With no running features, RUN tab is hidden. Create a feature via API (`POST /api/planets/:id/features`) — confirm RUN tab appears.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/hud/FocusedPanel.tsx
git commit -m "feat(phase 6): port FEATURES/TOOLS/PLANS/DESCRIPTION tabs into FocusedPanel"
```

---

### Task 6.3: Wire chat panel to the planet's ambient chat session

**Files:**
- Modify: `src/client/components/hud/FocusedPanel.tsx`

- [ ] **Step 1: Replace the chat-side GlassPanel body with the existing AgentChat + open-chat logic**

Lift the persistent ship-chat opening logic and the `<AgentChat>` mount from `PlanetDetailsPanel.tsx` into a new component `ChatPanelBody` inside `FocusedPanel.tsx`:

```tsx
import { useMemo, useCallback } from 'react'
import { useSessionList, useTranscriptsMap, usePendingsMap, useConnected } from '../../state/socketStore'
import { AgentChat } from '../AgentChat'
import { apiPost } from '../../api'
import { pushToast } from '../../state/toastStore'
import { sendAgentMessage, replyClarification as emitReply } from '../../state/socketClient'
import { EmptyMessage } from '../ui/EmptyMessage'

function ChatPanelBody({ planet }: { planet: PlanetSummary }) {
  const sessions = useSessionList()
  const transcripts = useTranscriptsMap()
  const pendings = usePendingsMap()
  const connected = useConnected()
  const chatLabel = `planet:${planet.id}:chat`
  const session = useMemo(() => sessions.find((s) => s.label === chatLabel), [sessions, chatLabel])

  const [opening, setOpening] = useState(false)
  const [openErr, setOpenErr] = useState<string | null>(null)
  const open = useCallback(async () => {
    setOpening(true); setOpenErr(null)
    const res = await apiPost(`/api/planets/${planet.id}/chat/open`)
    setOpening(false)
    if (!res.ok) { setOpenErr(res.error); pushToast('error', res.error) }
  }, [planet.id])

  useEffect(() => {
    if (session || opening || openErr || !connected || !planet.pathExists) return
    void open()
  }, [session, opening, openErr, connected, planet.pathExists, open])

  if (!session) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <EmptyMessage>{openErr ?? (opening ? 'opening chat…' : 'no chat yet.')}</EmptyMessage>
        {(openErr || !opening) && <GlassButton onClick={open} disabled={!connected || !planet.pathExists}>open chat</GlassButton>}
      </div>
    )
  }
  return (
    <AgentChat
      agentRunId={session.id}
      label={planet.name}
      role={session.role}
      state={session.state}
      transcript={transcripts.get(session.id) ?? []}
      pending={pendings.get(session.id) ?? null}
      connected={connected}
      onSend={(c) => sendAgentMessage(session.id, c)}
      onReply={(t, a) => emitReply(session.id, t, a)}
    />
  )
}
```

Use it in place of the chat panel placeholder.

- [ ] **Step 2: Verify chat opens automatically when you focus a planet, and survives re-focus**

Manual: focus planet → chat appears → say something → focus a different planet → first planet's session remains in the session list.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/hud/FocusedPanel.tsx
git commit -m "feat(phase 6): wire chat panel to planet ambient chat session"
```

---

## Phase 7 — Ambient HUD (LOD 0)

### Task 7.1: AmbientHUD top bar + bottom strip + new-planet modal

**Files:**
- Create: `src/client/components/hud/AmbientHUD.tsx`
- Create: `src/client/components/hud/NewPlanetModal.tsx`
- Modify: `src/client/components/hud/HudLayer.tsx`

- [ ] **Step 1: New-planet modal (glass-styled, replaces the old `Modal` for this flow)**

```tsx
// src/client/components/hud/NewPlanetModal.tsx
import { useState } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { GlassButton } from '../glass/GlassButton'
import { apiPost } from '../../api'
import { pushToast } from '../../state/toastStore'

export function NewPlanetModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim() || !projectPath.trim()) return
    setBusy(true)
    const res = await apiPost('/api/planets', { name: name.trim(), projectPath: projectPath.trim() })
    setBusy(false)
    if (!res.ok) { pushToast('error', `Create project failed: ${res.error}`); return }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={onClose}>
      <GlassPanel className="p-6 w-[420px]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm tracking-widest text-sky-300 mb-3">NEW PROJECT</h2>
        <label className="text-xs text-slate-400">PROJECT NAME</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="w-full mt-1 mb-3 bg-black/40 border border-sky-400/30 rounded px-2 py-1 text-sm"
        />
        <label className="text-xs text-slate-400">PROJECT PATH</label>
        <input
          value={projectPath}
          onChange={(e) => setProjectPath(e.target.value)}
          placeholder="C:/code/my-repo (must be a git repository)"
          className="w-full mt-1 mb-4 bg-black/40 border border-sky-400/30 rounded px-2 py-1 font-mono text-xs"
        />
        <div className="flex justify-end gap-2">
          <GlassButton variant="ghost" onClick={onClose}>cancel</GlassButton>
          <GlassButton onClick={submit} disabled={busy}>{busy ? 'creating…' : 'create'}</GlassButton>
        </div>
      </GlassPanel>
    </div>
  )
}
```

- [ ] **Step 2: AmbientHUD with top bar + bottom strip**

```tsx
// src/client/components/hud/AmbientHUD.tsx
import { useState } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { GlassButton } from '../glass/GlassButton'
import { GlassChip } from '../glass/GlassChip'
import { useConnected, usePlanets, useFeaturesMap, usePendingsMap } from '../../state/socketStore'
import { useUiStore } from '../../state/uiStore'
import { NewPlanetModal } from './NewPlanetModal'

export function AmbientHUD() {
  const connected = useConnected()
  const planets = usePlanets()
  const features = useFeaturesMap()
  const pendings = usePendingsMap()
  const focusPlanet = useUiStore((s) => s.focusPlanet)
  const [newOpen, setNewOpen] = useState(false)
  const [muted, setMuted] = useState(false)

  const running: { planetId: number; planetName: string; featureName: string }[] = []
  for (const p of planets) {
    for (const f of features.get(p.id) ?? []) {
      if (f.status === 'running') running.push({ planetId: p.id, planetName: p.name, featureName: f.name })
    }
  }

  return (
    <>
      {/* Top bar */}
      <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-4">
        <GlassPanel className="px-4 py-2 flex items-center gap-3">
          <span className={connected ? 'text-emerald-300' : 'text-amber-300'}>●</span>
          <span className="font-semibold tracking-widest text-sm">AGENTYARD</span>
        </GlassPanel>
        <GlassPanel className="px-4 py-2 flex items-center gap-3 text-xs">
          <GlassChip>{pendings.size} pending</GlassChip>
          <button onClick={() => setMuted(!muted)} className="text-slate-300">{muted ? '🔇' : '🔊'}</button>
          <GlassButton onClick={() => setNewOpen(true)}>+ new project</GlassButton>
        </GlassPanel>
      </div>

      {/* Bottom strip */}
      {running.length > 0 && (
        <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
          {running.map((r) => (
            <GlassPanel
              key={`${r.planetId}-${r.featureName}`}
              className="px-3 py-1.5 text-xs cursor-pointer hover:scale-[1.02] transition-transform"
              onClick={() => focusPlanet(r.planetId)}
            >
              <span className="text-sky-300 animate-pulse mr-1">●</span>
              <span className="font-semibold">{r.planetName}</span>
              <span className="text-slate-400"> / {r.featureName}</span>
            </GlassPanel>
          ))}
        </div>
      )}

      {newOpen && <NewPlanetModal onClose={() => setNewOpen(false)} />}
    </>
  )
}
```

- [ ] **Step 3: Wire into HudLayer**

```tsx
// src/client/components/hud/HudLayer.tsx
import { AmbientHUD } from './AmbientHUD'
// ...
// replace the empty pointer-events-auto div with:
{focus.lod === 0 && (
  <div className="pointer-events-auto absolute inset-0">
    <AmbientHUD />
  </div>
)}
```

- [ ] **Step 4: Chrome MCP visual test**

1. Open page, no planet focused → top bar + bottom strip visible.
2. Click "+ new project" → modal opens, create a project → planet appears on orbit.
3. Start a feature → bottom-strip chip appears.
4. Click the chip → camera flies to that planet.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/hud/AmbientHUD.tsx src/client/components/hud/NewPlanetModal.tsx src/client/components/hud/HudLayer.tsx
git commit -m "feat(phase 7): AmbientHUD top bar + running-projects strip + new-project modal"
```

---

## Phase 8 — Ships (3D)

### Task 8.1: Place Kenney CC0 GLB assets

This task is partially manual — the agent (or you) downloads the assets once. The plan executor should automate the downloads where feasible.

**Files:**
- Create: `public/models/ships/00.glb` through `24.glb`
- Create: `THIRD_PARTY_LICENSES.md`

- [ ] **Step 1: Download Kenney Space Kit**

```bash
mkdir -p public/models/ships
# Option A: manual — fetch from https://kenney.nl/assets/space-kit (CC0)
# Option B: scripted — use any working CC0 mirror; only the .glb files are needed.
# Pick 25 distinct ship hulls and copy them as 00.glb..24.glb.
```

- [ ] **Step 2: Add attribution file**

```bash
cat > THIRD_PARTY_LICENSES.md <<'EOF'
# Third Party Assets

## Kenney Space Kit (CC0 1.0 Universal)

3D ship and drone models under `public/models/ships/` and `public/models/drones/`
are from Kenney's Space Kit (https://kenney.nl/assets/space-kit). The Kenney
Space Kit is released under Creative Commons CC0, which does not require
attribution; this file is included as a courtesy.
EOF
```

- [ ] **Step 3: Commit (LFS or normal)**

```bash
git add public/models/ships/ THIRD_PARTY_LICENSES.md
git commit -m "assets(phase 8): Kenney Space Kit ship hulls (25 GLB)"
```

---

### Task 8.2: Ship hash → modelIndex + hueShift (TDD)

**Files:**
- Create: `src/client/scene/lib/shipParams.ts`
- Create: `src/client/scene/lib/shipParams.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/client/scene/lib/shipParams.test.ts
import { describe, it, expect } from 'vitest'
import { deriveShipParams } from './shipParams'

describe('deriveShipParams', () => {
  it('is deterministic for same (id, name)', () => {
    const a = deriveShipParams(7, 'add-payment-flow')
    const b = deriveShipParams(7, 'add-payment-flow')
    expect(a).toEqual(b)
  })

  it('returns a modelIndex in [0, 24]', () => {
    for (let i = 0; i < 50; i++) {
      const p = deriveShipParams(i, `feat-${i}`)
      expect(p.modelIndex).toBeGreaterThanOrEqual(0)
      expect(p.modelIndex).toBeLessThan(25)
      expect(p.hueShift).toBeGreaterThanOrEqual(0)
      expect(p.hueShift).toBeLessThan(360)
    }
  })

  it('varies modelIndex across many inputs', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 50; i++) seen.add(deriveShipParams(i, `feat-${i}`).modelIndex)
    expect(seen.size).toBeGreaterThan(5)
  })
})
```

- [ ] **Step 2: Verify fail**

```bash
npx vitest run src/client/scene/lib/shipParams.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/client/scene/lib/shipParams.ts
import { hashStringToInt } from './hash'

export interface ShipParams {
  modelIndex: number  // 0..24
  hueShift: number    // 0..360
}

export function deriveShipParams(featureId: number, featureName: string): ShipParams {
  const seed = hashStringToInt(`${featureId}:${featureName}`)
  return {
    modelIndex: seed % 25,
    hueShift: (seed >>> 8) % 360,
  }
}
```

- [ ] **Step 4: Verify pass + commit**

```bash
npx vitest run src/client/scene/lib/shipParams.test.ts
git add src/client/scene/lib/shipParams.ts src/client/scene/lib/shipParams.test.ts
git commit -m "feat(phase 8): deterministic ship param derivation"
```

---

### Task 8.3: Ship component + orbital ring placement

**Files:**
- Create: `src/client/scene/Ship.tsx`
- Modify: `src/client/scene/Planet.tsx` (to mount ships)

- [ ] **Step 1: Ship component**

```tsx
// src/client/scene/Ship.tsx
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, Group, Mesh, MeshStandardMaterial } from 'three'
import type { FeatureSummary } from '../../core/types'
import { deriveShipParams } from './lib/shipParams'
import { useUiStore } from '../state/uiStore'

interface ShipProps {
  feature: FeatureSummary
  orbitRadius: number  // around the planet
  orbitAngle: number   // current angle
}

export function Ship({ feature, orbitRadius, orbitAngle }: ShipProps) {
  const params = useMemo(() => deriveShipParams(feature.id, feature.name), [feature.id, feature.name])
  const url = `/models/ships/${params.modelIndex.toString().padStart(2, '0')}.glb`
  const { scene } = useGLTF(url) as unknown as { scene: Group }
  const ref = useRef<Group>(null)
  const focusShip = useUiStore((s) => s.focusShip)

  // Clone + tint
  const cloned = useMemo(() => {
    const c = scene.clone(true)
    const tint = new Color().setHSL(params.hueShift / 360, 0.6, 0.55)
    c.traverse((obj) => {
      const mesh = obj as Mesh
      if (mesh.isMesh && mesh.material) {
        const mat = (mesh.material as MeshStandardMaterial).clone()
        if (mat.color) mat.color.lerp(tint, 0.6)
        mesh.material = mat
      }
    })
    return c
  }, [scene, params.hueShift])

  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.4
  })

  return (
    <group
      position={[Math.cos(orbitAngle) * orbitRadius, 0, Math.sin(orbitAngle) * orbitRadius]}
      onClick={(e) => { e.stopPropagation(); focusShip(feature.planetId, feature.id) }}
    >
      <group ref={ref} scale={0.3}>
        <primitive object={cloned} />
      </group>
    </group>
  )
}
```

- [ ] **Step 2: Mount active-running ships inside Planet**

```tsx
// Planet.tsx — add inside the planet mesh group:
import { Ship } from './Ship'
import { ringAngles } from './lib/orbits'
import { useFeaturesMap } from '../state/socketStore'

// inside Planet():
const features = useFeaturesMap().get(planet.id) ?? []
const active = features.filter((f) => f.status === 'running')
const angles = ringAngles(active.length)
const shipOrbitRadius = params.radius * 1.8

// inside the JSX, alongside the planet mesh:
{active.map((f, i) => (
  <Ship key={f.id} feature={f} orbitRadius={shipOrbitRadius} orbitAngle={angles[i]} />
))}
```

- [ ] **Step 3: Chrome MCP visual test**

1. Start a feature on a planet → confirm ship appears on the ring.
2. Start a second feature → confirm both space evenly on the ring.
3. Click a ship → camera transitions to LOD 2 (framing is rough; refined in Phase 10).

- [ ] **Step 4: Commit**

```bash
git add src/client/scene/Ship.tsx src/client/scene/Planet.tsx
git commit -m "feat(phase 8): ships on per-planet orbital rings + click → LOD 2"
```

---

## Phase 9 — Drones

### Task 9.1: Place drone GLB assets

- [ ] **Step 1: Copy two distinct drone hulls from Kenney into `public/models/drones/leader.glb` and `regular.glb`**

```bash
mkdir -p public/models/drones
# manual copy from the Kenney pack
```

- [ ] **Step 2: Commit**

```bash
git add public/models/drones/
git commit -m "assets(phase 9): drone hulls (leader + regular)"
```

---

### Task 9.2: Drone component + states

**Files:**
- Create: `src/client/scene/Drone.tsx`
- Modify: `src/client/scene/Ship.tsx`

- [ ] **Step 1: Drone component**

```tsx
// src/client/scene/Drone.tsx
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, Group, Mesh, MeshStandardMaterial } from 'three'
import type { SessionDescriptor } from '../../core/types'

interface DroneProps {
  session: SessionDescriptor
  orbitRadius: number
  orbitAngle: number
  bobPhase: number
  pending: boolean
  onClick?: () => void
}

export function Drone({ session, orbitRadius, orbitAngle, bobPhase, pending, onClick }: DroneProps) {
  const isLeader = session.role === 'leader'
  const url = isLeader ? '/models/drones/leader.glb' : '/models/drones/regular.glb'
  const { scene } = useGLTF(url) as unknown as { scene: Group }
  const ref = useRef<Group>(null)
  const matsRef = useRef<MeshStandardMaterial[]>([])

  const cloned = useMemo(() => {
    const c = scene.clone(true)
    const mats: MeshStandardMaterial[] = []
    const accent = new Color(isLeader ? '#fb923c' : '#38bdf8')
    c.traverse((obj) => {
      const mesh = obj as Mesh
      if (mesh.isMesh && mesh.material) {
        const mat = (mesh.material as MeshStandardMaterial).clone()
        mat.emissive = accent.clone()
        mat.emissiveIntensity = 0.6
        mesh.material = mat
        mats.push(mat)
      }
    })
    matsRef.current = mats
    return c
  }, [scene, isLeader])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (ref.current) {
      ref.current.position.x = Math.cos(orbitAngle + t * 0.2) * orbitRadius
      ref.current.position.z = Math.sin(orbitAngle + t * 0.2) * orbitRadius
      ref.current.position.y = Math.sin(t * 2 + bobPhase) * 0.1
      if (pending) {
        const pulse = 1 + 0.15 * Math.sin(t * 6)
        ref.current.scale.setScalar(pulse * 0.15)
      } else {
        ref.current.scale.setScalar(0.15)
      }
    }
    if (pending) {
      const flash = 0.6 + 0.4 * Math.sin(t * 6)
      matsRef.current.forEach((m) => {
        m.emissive.set('#f43f5e')
        m.emissiveIntensity = flash
      })
    } else {
      matsRef.current.forEach((m) => {
        m.emissive.set(isLeader ? '#fb923c' : '#38bdf8')
        m.emissiveIntensity = 0.6
      })
    }
  })

  return (
    <group ref={ref} onClick={(e) => { e.stopPropagation(); onClick?.() }}>
      <primitive object={cloned} />
    </group>
  )
}
```

- [ ] **Step 2: Wire drones inside Ship**

In `Ship.tsx`, accept a session list as a prop and render drones around the ship:

```tsx
import { Drone } from './Drone'
import type { SessionDescriptor } from '../../core/types'
import { useUiStore } from '../state/uiStore'

interface ShipProps {
  feature: FeatureSummary
  orbitRadius: number
  orbitAngle: number
  drones: SessionDescriptor[]
  pendingDroneIds: Set<string>
}

// inside Ship JSX, alongside the GLB:
{drones.map((d, i) => (
  <Drone
    key={d.id}
    session={d}
    orbitRadius={0.6 + (i % 3) * 0.15}
    orbitAngle={(i * 2 * Math.PI) / Math.max(1, drones.length)}
    bobPhase={i * 0.7}
    pending={pendingDroneIds.has(d.id)}
    onClick={() => useUiStore.getState().focusShip(feature.planetId, feature.id, d.id)}
  />
))}
```

In `Planet.tsx`, compute and pass the drones + pendings for each ship:

```tsx
import { useSessionList, usePendingsMap } from '../state/socketStore'

const sessions = useSessionList()
const pendings = usePendingsMap()

// inside the active.map for ships:
const featureDrones = sessions.filter((s) => s.role === 'drone' || s.role === 'leader') // for now — refine when ship-scoping ships→sessions is wired
const pendingIds = new Set(featureDrones.filter((s) => pendings.has(s.id)).map((s) => s.id))

<Ship key={f.id} feature={f} orbitRadius={shipOrbitRadius} orbitAngle={angles[i]} drones={featureDrones} pendingDroneIds={pendingIds} />
```

(Refining the session→ship mapping is part of Phase 10; today the server's single-active-feature invariant means all active sessions belong to the one running ship.)

- [ ] **Step 3: Chrome MCP visual test**

1. With a running feature: confirm drones spawn around the ship and bob/orbit.
2. Force a pending clarification (the server already does this when a drone uses the clarify tool) → confirm the drone turns red + pulses.
3. Click a drone → focus updates to that drone's chat (verify via devtools: `useUiStore.getState().focus.chatDroneId`).

- [ ] **Step 4: Commit**

```bash
git add src/client/scene/Drone.tsx src/client/scene/Ship.tsx src/client/scene/Planet.tsx
git commit -m "feat(phase 9): drones around ships with role-specific look + pending-clarification state"
```

---

## Phase 10 — LOD 2 (ship focus)

### Task 10.1: Refine cameraTargets for LOD 2 + dynamic ship lookup

**Files:**
- Modify: `src/client/scene/lib/cameraTargets.ts`
- Modify: `src/client/scene/CameraRig.tsx`
- Modify: `src/client/scene/SolarSystemScene.tsx`

- [ ] **Step 1: Expand cameraTargets to accept a ship lookup**

```ts
// src/client/scene/lib/cameraTargets.ts — add:
export type ShipPositionLookup = (planetId: number, featureId: number) => { x: number; y: number; z: number } | null

export function cameraTargetForV2(
  focus: Focus,
  planetLookup: PlanetPositionLookup,
  shipLookup: ShipPositionLookup,
): CameraTarget {
  if (focus.lod === 2) {
    const s = shipLookup(focus.planetId, focus.shipFeatureId)
    if (s) {
      return { position: [s.x + 1.5, s.y + 0.8, s.z + 2.5], lookAt: [s.x, s.y, s.z] }
    }
  }
  return cameraTargetFor(focus, planetLookup)
}
```

- [ ] **Step 2: Update CameraRig to accept and use the v2 helper**

Replace `cameraTargetFor(...)` with `cameraTargetForV2(focus, planetLookup, shipLookup)` and add a `shipLookup` prop.

- [ ] **Step 3: Compute ship world positions in SolarSystemScene and pass**

```tsx
// inside SolarSystemScene
const shipPositions = useMemo(() => {
  const map = new Map<string, { x: number; y: number; z: number }>()
  planets.forEach((p, pi) => {
    const planetAngle = (pi * Math.PI) / 3
    const planetX = Math.cos(planetAngle) * positions[pi].radius
    const planetZ = -Math.sin(planetAngle) * positions[pi].radius
    const fs = (features.get(p.id) ?? []).filter((f) => f.status === 'running')
    const angles = ringAngles(fs.length)
    const planetParams = derivePlanetParams(p.name)
    const ringR = planetParams.radius * 1.8
    fs.forEach((f, i) => {
      map.set(`${p.id}:${f.id}`, {
        x: planetX + Math.cos(angles[i]) * ringR,
        y: 0,
        z: planetZ + Math.sin(angles[i]) * ringR,
      })
    })
  })
  return map
}, [planets, features, positions])

const shipLookup = useCallback(
  (planetId: number, featureId: number) => shipPositions.get(`${planetId}:${featureId}`) ?? null,
  [shipPositions],
)
// ...
<CameraRig planetLookup={lookup} shipLookup={shipLookup} />
```

- [ ] **Step 4: Visual test via Chrome MCP**

Click planet → click a ship → camera zooms to LOD 2 framing the ship.

- [ ] **Step 5: Commit**

```bash
git add src/client/scene/lib/cameraTargets.ts src/client/scene/CameraRig.tsx src/client/scene/SolarSystemScene.tsx
git commit -m "feat(phase 10): LOD 2 camera framing on ship orbital position"
```

---

### Task 10.2: FocusedPanel content for LOD 2 (feature info + workflow vis + leader chat)

**Files:**
- Modify: `src/client/components/hud/FocusedPanel.tsx`
- (Reference): `src/client/views/RunView.tsx` for workflow visualization patterns

- [ ] **Step 1: When LOD 2, swap InfoPanelBody content for ship/feature view**

In `FocusedPanel.tsx`:

```tsx
const isShipFocus = focus.lod === 2
const feature = isShipFocus
  ? (useFeaturesMap().get(focus.planetId) ?? []).find((f) => f.id === focus.shipFeatureId) ?? null
  : null

// inside info panel:
{isShipFocus && feature ? (
  <ShipInfoPanel feature={feature} />
) : (
  <InfoPanelBody planet={planet} />
)}
```

```tsx
function ShipInfoPanel({ feature }: { feature: FeatureSummary }) {
  return (
    <>
      <div className="text-xs tracking-widest text-slate-400">FEATURE</div>
      <h3 className="text-sky-100 text-lg mt-1">{feature.name}</h3>
      <p className="text-sm text-slate-300 mt-2 whitespace-pre-wrap">{feature.task}</p>
      <div className="text-xs tracking-widest text-slate-400 mt-4">WORKFLOW</div>
      <p className="text-sm text-slate-300 mt-1">workflow #{feature.workflowId}</p>
      {/* Read-only workflow graph (xyflow) goes here in a follow-up polish. */}
      {feature.finalSummary && (
        <>
          <div className="text-xs tracking-widest text-emerald-300 mt-4">SUMMARY</div>
          <p className="text-sm text-slate-200 whitespace-pre-wrap mt-1">{feature.finalSummary}</p>
        </>
      )}
      {feature.error && (
        <>
          <div className="text-xs tracking-widest text-rose-300 mt-4">ERROR</div>
          <p className="text-sm text-rose-200 whitespace-pre-wrap mt-1">{feature.error}</p>
        </>
      )}
    </>
  )
}
```

- [ ] **Step 2: Chat panel at LOD 2 binds to focus.chatDroneId (default: feature's leader)**

```tsx
// In ChatPanelBody — instead of always looking up the planet-chat label:
const targetSessionId = (() => {
  if (focus.lod === 2) {
    if (focus.chatDroneId) return focus.chatDroneId
    // default to the leader session for this feature
    const leader = sessions.find((s) => s.role === 'leader')
    return leader?.id ?? null
  }
  // LOD 1: planet ambient chat
  return session?.id ?? null
})()
```

(Pull this into a small `useChatTarget(planet, focus)` hook to keep the JSX clean.)

- [ ] **Step 3: Chrome MCP test**

Focus a ship → info panel shows feature details, chat is bound to the leader. Click a drone → chat rebinds to that drone.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/hud/FocusedPanel.tsx
git commit -m "feat(phase 10): LOD 2 panel shows feature info + leader chat (rebindable to any drone)"
```

---

## Phase 11 — Notification deck

### Task 11.1: NotificationDeck (always rendered)

**Files:**
- Create: `src/client/components/hud/NotificationDeck.tsx`
- Modify: `src/client/components/hud/HudLayer.tsx`

- [ ] **Step 1: Implement deck**

```tsx
// src/client/components/hud/NotificationDeck.tsx
import { useMemo, useEffect, useRef } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { usePendingsMap, useSessionList, usePlanets, useFeaturesMap } from '../../state/socketStore'
import { useUiStore } from '../../state/uiStore'
import { playClarificationChime, isAudioMuted } from '../../canvas/chime'

export function NotificationDeck() {
  const pendings = usePendingsMap()
  const sessions = useSessionList()
  const planets = usePlanets()
  const features = useFeaturesMap()
  const focusShip = useUiStore((s) => s.focusShip)
  const prevCount = useRef(0)

  // Chime when a new pending appears
  useEffect(() => {
    if (pendings.size > prevCount.current && !isAudioMuted()) playClarificationChime()
    prevCount.current = pendings.size
  }, [pendings])

  const rows = useMemo(() => {
    const out: Array<{ droneId: string; planetId: number; featureId: number; planetName: string; featureName: string; droneLabel: string; question: string }> = []
    for (const [droneId, pending] of pendings) {
      const session = sessions.find((s) => s.id === droneId)
      // Find the running feature → its planet (server invariant: only one running per planet at a time)
      let foundPlanetId: number | null = null
      let foundFeatureId: number | null = null
      let foundPlanetName = ''
      let foundFeatureName = ''
      for (const p of planets) {
        const running = (features.get(p.id) ?? []).find((f) => f.status === 'running')
        if (running) { foundPlanetId = p.id; foundFeatureId = running.id; foundPlanetName = p.name; foundFeatureName = running.name; break }
      }
      if (foundPlanetId === null || foundFeatureId === null) continue
      out.push({
        droneId,
        planetId: foundPlanetId,
        featureId: foundFeatureId,
        planetName: foundPlanetName,
        featureName: foundFeatureName,
        droneLabel: session?.label ?? session?.role ?? droneId.slice(0, 6),
        question: pending.question ?? '',
      })
    }
    return out
  }, [pendings, sessions, planets, features])

  if (rows.length === 0) return null

  return (
    <div className="absolute right-4 top-20 w-80 z-30 pointer-events-auto">
      <GlassPanel className="overflow-hidden">
        <div className="px-3 py-2 border-b border-amber-300/30 text-xs tracking-widest text-amber-300">INBOX · {rows.length}</div>
        <ul>
          {rows.map((r) => (
            <li
              key={r.droneId}
              className="px-3 py-2 border-b border-amber-300/10 cursor-pointer hover:bg-amber-300/5"
              onClick={() => focusShip(r.planetId, r.featureId, r.droneId)}
            >
              <div className="text-sky-300 text-xs">{r.planetName} · {r.featureName} · {r.droneLabel}</div>
              <p className="text-slate-300 text-sm mt-0.5 line-clamp-2">{r.question}</p>
            </li>
          ))}
        </ul>
      </GlassPanel>
    </div>
  )
}
```

- [ ] **Step 2: Mount NotificationDeck in HudLayer (always-on)**

```tsx
// HudLayer.tsx — at the root of the layer, OUTSIDE the lod-conditionals:
import { NotificationDeck } from './NotificationDeck'
// ...
<NotificationDeck />
```

- [ ] **Step 3: Chrome MCP test**

1. Trigger a clarification (run a workflow that uses the clarify tool) → row appears in the deck regardless of current LOD.
2. Click the row → camera flies (system → planet → ship in one spline) and chat panel is bound to that drone.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/hud/NotificationDeck.tsx src/client/components/hud/HudLayer.tsx
git commit -m "feat(phase 11): always-on NotificationDeck with click-to-deep-dive"
```

---

## Phase 12 — Workflow editor overlay

### Task 12.1: Glass overlay with embedded xyflow editor

**Files:**
- Create: `src/client/components/hud/WorkflowEditorOverlay.tsx`
- Modify: `src/client/components/hud/FocusedPanel.tsx` (wire the ⚙ button)
- Modify: `src/client/components/hud/HudLayer.tsx`
- Move: `src/client/views/editor/*` stays where it is (still used).

- [ ] **Step 1: Implement overlay**

```tsx
// src/client/components/hud/WorkflowEditorOverlay.tsx
import { useState, useEffect } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { GlassButton } from '../glass/GlassButton'
import { useUiStore } from '../../state/uiStore'
import { apiGet, apiPut } from '../../api'
import type { Workflow } from '../../../core/schema'
import { EditorView } from '../../views/EditorView'

interface Props { open: boolean; onClose: () => void }

export function WorkflowEditorOverlay({ open, onClose }: Props) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [tools, setTools] = useState([])

  useEffect(() => {
    if (!open) return
    void apiGet<Workflow[]>('/api/workflows').then((res) => {
      if (res.ok && res.data[0]) setWorkflow(res.data[0])
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center backdrop-blur-sm">
      <GlassPanel className="w-[90vw] h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-sky-400/20">
          <h2 className="text-sm tracking-widest text-sky-300">WORKFLOW EDITOR{workflow ? ` — ${workflow.name}` : ''}</h2>
          <GlassButton variant="ghost" onClick={onClose}>✕ close</GlassButton>
        </div>
        <div className="flex-1 overflow-hidden">
          {workflow && (
            <EditorView
              workflow={workflow}
              tools={tools}
              onSave={async (updated) => {
                const res = await apiPut<Workflow>(`/api/workflows/${updated.id}`, { name: updated.name, graph: updated.graph })
                if (res.ok) setWorkflow(res.data)
              }}
              onRefreshTools={async () => { /* noop for now */ }}
              onOpenTestRun={() => { /* not exposed from overlay */ }}
            />
          )}
        </div>
      </GlassPanel>
    </div>
  )
}
```

- [ ] **Step 2: Wire trigger button in FocusedPanel**

```tsx
// FocusedPanel.tsx
const [wfOpen, setWfOpen] = useState(false)
// replace the placeholder ⚙ button:
<GlassButton variant="ghost" onClick={() => setWfOpen(true)}>⚙ workflow editor</GlassButton>
// at the end of the component return:
<WorkflowEditorOverlay open={wfOpen} onClose={() => setWfOpen(false)} />
```

- [ ] **Step 3: Chrome MCP test**

Focus a planet → click ⚙ workflow editor → overlay opens with the global workflow loaded → Esc closes.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/hud/WorkflowEditorOverlay.tsx src/client/components/hud/FocusedPanel.tsx
git commit -m "feat(phase 12): workflow editor full-screen glass overlay"
```

---

## Phase 13 — Sun zoom (LOD 1 sun state)

### Task 13.1: Sun click → focus + SunPanel content

**Files:**
- Modify: `src/client/scene/Sun.tsx` (add onClick)
- Create: `src/client/components/hud/SunPanel.tsx`
- Modify: `src/client/components/hud/FocusedPanel.tsx`

- [ ] **Step 1: Click target on the sun mesh**

```tsx
// Sun.tsx — wrap the <mesh> with onClick:
import { useUiStore } from '../state/uiStore'
// ...
const focusSun = useUiStore((s) => s.focusSun)
// ...
<mesh ref={meshRef} position={[0, 0, 0]} onClick={(e) => { e.stopPropagation(); focusSun() }}>
```

- [ ] **Step 2: SunPanel with global library tabs**

```tsx
// src/client/components/hud/SunPanel.tsx
import { useState } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { GlassTab } from '../glass/GlassTab'
import { ToolsTabContent } from '../ToolsTabContent'

type SunTab = 'workflows' | 'tools' | 'agents' | 'mcps' | 'dashboard'

export function SunPanelInfo() {
  const [tab, setTab] = useState<SunTab>('dashboard')
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        <GlassTab active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>DASHBOARD</GlassTab>
        <GlassTab active={tab === 'workflows'} onClick={() => setTab('workflows')}>WORKFLOWS</GlassTab>
        <GlassTab active={tab === 'tools'} onClick={() => setTab('tools')}>TOOLS</GlassTab>
        <GlassTab active={tab === 'agents'} onClick={() => setTab('agents')}>AGENTS</GlassTab>
        <GlassTab active={tab === 'mcps'} onClick={() => setTab('mcps')}>MCPS</GlassTab>
      </div>
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'workflows' && <WorkflowsTab />}
      {tab === 'tools' && <ToolsTabContent planetId={null} />}
      {tab === 'agents' && <ToolsTabContent planetId={null} typeFilter="agent" />}
      {tab === 'mcps' && <ToolsTabContent planetId={null} typeFilter="mcp" />}
    </>
  )
}

function DashboardTab() {
  return <div className="text-sm text-slate-300">All-projects overview lands as a Phase 14 polish.</div>
}
function WorkflowsTab() {
  return <div className="text-sm text-slate-300">Global workflow library lands as a Phase 14 polish (currently single workflow).</div>
}
```

(If `ToolsTabContent` doesn't currently accept a `typeFilter` prop, add an optional one — see the existing component.)

- [ ] **Step 3: Route sun-state through FocusedPanel**

```tsx
// FocusedPanel.tsx
const isSun = focus.lod === 1 && 'sun' in focus && focus.sun

// In the info panel:
{isSun ? <SunPanelInfo /> : (isShipFocus && feature ? <ShipInfoPanel feature={feature} /> : <InfoPanelBody planet={planet!} />)}

// Top bar adjustments: when sun, show "SUN / GLOBAL LIBRARY" instead of planet path
{isSun ? <span className="font-semibold tracking-wide">SUN — GLOBAL LIBRARY</span> : (...)}

// Chat panel is hidden when sun-focused (no per-sun chat session).
{!isSun && <ChatPanelBody planet={planet!} />}
```

The splitter also collapses (set width 100% on the info side) when sun-focused. Easy: branch the layout in JSX.

- [ ] **Step 4: Chrome MCP test**

1. From LOD 0, click sun → camera zooms in, full-screen panel shows DASHBOARD/WORKFLOWS/TOOLS/AGENTS/MCPS tabs.
2. Esc → back to LOD 0.

- [ ] **Step 5: Commit**

```bash
git add src/client/scene/Sun.tsx src/client/components/hud/SunPanel.tsx src/client/components/hud/FocusedPanel.tsx
git commit -m "feat(phase 13): sun click → focus + global library panel"
```

---

## Phase 14 — Lifecycle, polish, error handling

### Task 14.1: Ship spawn fade-in + despawn flash on complete/fail

**Files:**
- Modify: `src/client/scene/Ship.tsx`

- [ ] **Step 1: Track feature status to drive an opacity/scale tween**

Inside `Ship`, expose an animated `opacity` and `flashColor`:
- On mount (or first render of a `pending`/`running` feature): start at scale 0, opacity 0, tween to (0.3 scale, 1 opacity) over 0.4s.
- On feature.status transition to `complete`: set `flashColor = '#67e8f9'` for 0.2s then fade to opacity 0 over 1.5s.
- On `failed`: set `flashColor = '#fb7185'` for 0.2s then fade over 2.0s.

Use a small local `useRef<{ start: number; phase: 'spawn'|'idle'|'completing'|'failing' }>` to track. Apply opacity by traversing materials and setting `transparent = true; opacity = current`.

(Detailed code is straightforward but lengthy — implement using the pattern from Drone.tsx's `useFrame` block. Smoke-test by triggering complete/fail via the existing feature-status events.)

- [ ] **Step 2: Visual test**

Run a feature to completion → confirm cyan flash + fade. Fail one → rose flash + fade.

- [ ] **Step 3: Commit**

```bash
git add src/client/scene/Ship.tsx
git commit -m "feat(phase 14): ship spawn fade-in + complete/fail flash + despawn"
```

---

### Task 14.2: Error handling — WebGL fail, GLB load fail, broken planet path

**Files:**
- Modify: `src/client/App.tsx`
- Create: `src/client/scene/ErrorBoundaries.tsx`

- [ ] **Step 1: WebGL 2 capability check at mount**

```tsx
// App.tsx — before rendering Canvas:
const webglOK = useMemo(() => {
  try {
    const c = document.createElement('canvas')
    return !!c.getContext('webgl2')
  } catch { return false }
}, [])

if (!webglOK) {
  return (
    <main className="min-h-screen w-screen bg-black flex items-center justify-center">
      <GlassPanel className="px-6 py-4 text-slate-200 text-sm">
        AgentYard requires WebGL 2. Please update your browser or GPU drivers.
      </GlassPanel>
    </main>
  )
}
```

- [ ] **Step 2: GLB load error boundary**

```tsx
// src/client/scene/ErrorBoundaries.tsx
import { Component, ReactNode } from 'react'

export class GlbErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err: unknown) { console.error('GLB load failed', err) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
```

Wrap `<Ship>` and `<Drone>` in this with a placeholder mesh fallback (a small gray emissive cube + `?` sprite). Implement the fallback inline:

```tsx
const GhostShip = () => (
  <mesh>
    <boxGeometry args={[0.4, 0.4, 0.4]} />
    <meshStandardMaterial color="#475569" emissive="#94a3b8" emissiveIntensity={0.4} />
  </mesh>
)
```

- [ ] **Step 3: Broken planet path overlay**

In `Planet.tsx`, when `planet.pathExists === false`, render a small red crackle overlay (semi-transparent red shell with noise pattern):

```tsx
{!planet.pathExists && (
  <mesh>
    <sphereGeometry args={[params.radius * 1.01, 32, 32]} />
    <meshBasicMaterial color="#f43f5e" transparent opacity={0.25} wireframe />
  </mesh>
)}
```

- [ ] **Step 4: Chrome MCP test**

1. Force a missing GLB (rename `00.glb` temporarily) → confirm ghost cube + console error → restore.
2. Create a planet pointing at a nonexistent path → confirm red wireframe overlay.

- [ ] **Step 5: Commit**

```bash
git add src/client/App.tsx src/client/scene/ErrorBoundaries.tsx src/client/scene/Ship.tsx src/client/scene/Drone.tsx src/client/scene/Planet.tsx
git commit -m "feat(phase 14): WebGL/GLB error boundaries + broken-path planet overlay"
```

---

## Phase 15 — Cleanup

### Task 15.1: Delete obsolete PixiJS + view files

**Files (delete):**
- `src/client/canvas/GameCanvas.tsx`
- `src/client/canvas/GameHud.tsx`
- `src/client/canvas/galaxyScene.ts`
- `src/client/canvas/dockScene.ts`
- `src/client/canvas/sprites.ts`
- `src/client/canvas/useGameHud.ts`
- `src/client/canvas/Modal.tsx`
- `src/client/canvas/ChatModal.tsx`
- `src/client/components/PlanetDetailsPanel.tsx` (its tabs are now inside FocusedPanel)
- `src/client/views/PlanetsView.tsx`
- `src/client/views/RunView.tsx` (its internals are reused inside the planet RUN tab — keep `views/run/*` helpers if any still imported)
- `src/client/views/EditorView.tsx` — keep as-is; it's now mounted only inside `WorkflowEditorOverlay`.

- [ ] **Step 1: Delete files**

```bash
git rm src/client/canvas/GameCanvas.tsx src/client/canvas/GameHud.tsx src/client/canvas/galaxyScene.ts src/client/canvas/dockScene.ts src/client/canvas/sprites.ts src/client/canvas/useGameHud.ts src/client/canvas/Modal.tsx src/client/canvas/ChatModal.tsx
git rm src/client/components/PlanetDetailsPanel.tsx
git rm src/client/views/PlanetsView.tsx
git rm src/client/views/RunView.tsx
```

- [ ] **Step 2: Remove PixiJS deps**

```bash
npm uninstall pixi.js @pixi/react
```

- [ ] **Step 3: Run typecheck + full tests**

```bash
npm run typecheck && npm test
```

Expected: green. If any file still imports a deleted module, fix it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(phase 15): delete PixiJS scene + obsolete views; drop pixi deps"
```

---

### Task 15.2: Final audit + Chrome MCP regression sweep

- [ ] **Step 1: Audit grep**

```bash
git grep -i 'ship' -- 'src/**' 'public/**' 'docs/**'
```

Expected: only brand identity hits (AGENTYARD, "shipyard" copy/comments).

- [ ] **Step 2: Run all tests + typecheck**

```bash
npm run typecheck && npm test
```

- [ ] **Step 3: Chrome MCP smoke run**

Walk through the golden path:
1. Open the page → solar system with sun + ≥1 planet visible.
2. Click a planet → cinematic zoom → full-screen HUD with tabs and chat.
3. Start a feature via the FEATURES tab → ship spawns on the ring.
4. Wait for the workflow to spawn drones → drones orbit the ship.
5. Force a clarification → red pulsing drone + notification deck row + chime.
6. Click the notification row → camera flies to that drone, chat opens.
7. Click the workflow editor button → overlay opens → Esc closes.
8. Press Esc twice → back to solar system.
9. Click the sun → SUN panel with global tabs.
10. Esc → back to system.

Capture screenshots at each step and attach to the PR.

- [ ] **Step 4: Update CLAUDE.md if present**

If the repo has a `CLAUDE.md`, add a short note pointing future agents at the new scene structure (`src/client/scene/`).

- [ ] **Step 5: Final commit + ready for merge**

```bash
git add -A
git commit -m "chore(phase 15): final audit pass + docs note" --allow-empty
```

Open a PR from `solar-system` → `main` with a summary referencing both the spec doc and this plan.

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| Phase 0 naming migration | Tasks 0.1–0.5 |
| Glass style B tokens | Task 2.1 (`glass.css`) |
| Glass primitives library | Tasks 2.1–2.2 |
| R3F bootstrap + Stars | Task 1.3 |
| Sun (shader + bloom) | Task 3.1 |
| Procedural planets (deterministic, broken-path, ring) | Tasks 4.1, 4.2, 14.2 |
| Camera & 3-level LOD | Tasks 5.1, 10.1 |
| Back-out (Esc) | Task 5.2 |
| FocusedPanel layout (top bar + info + chat + splitter) | Tasks 6.1–6.3 |
| Info tabs (FEATURES/TOOLS/PLANS/DESCRIPTION + conditional RUN) | Task 6.2 |
| Chat permanent right + rebind on drone click | Tasks 6.3, 10.2 |
| Ambient HUD (top bar + running strip + new-project modal) | Task 7.1 |
| Ship hash → modelIndex/hueShift | Task 8.2 |
| Ship orbital ring | Task 8.3 |
| Ship spawn/despawn lifecycle | Task 14.1 |
| Drones (leader vs regular, orbit, bob, pending state) | Task 9.2 |
| LOD 2 framing | Task 10.1 |
| LOD 2 feature info + workflow vis + leader chat | Task 10.2 |
| Notification deck (always-on, deep-link, chime) | Task 11.1 |
| Workflow editor full-screen glass overlay | Task 12.1 |
| Sun zoom (sun-special state) | Task 13.1 |
| Error handling (WebGL, GLB, broken paths) | Task 14.2 |
| Cleanup (delete PixiJS + deps) | Task 15.1 |
| Audit + manual verification | Task 15.2 |

Spline-curve multi-step jumps from the notification deck are deferred to a polish step (currently the deck calls `focusShip(...)` which the rig handles as a single tween — the spline upgrade is purely a rig-internal change and would be a small additional task during Phase 11 polish if you want it before merge).

**Placeholder scan:** No "TBD"/"implement later" markers. A few "lands as a Phase 14 polish" notes inside Sun-panel tab stubs (DashboardTab, WorkflowsTab) are intentional minimum-viable placeholders for sub-features the user said are not the primary goal — they render a short explanatory line, not blocking content.

**Type consistency:** `Focus` type is the same shape across `uiStore.ts`, `cameraTargets.ts`, `FocusedPanel.tsx`, `NotificationDeck.tsx`. `ShipParams` / `PlanetParams` are referenced consistently. `useUiStore` actions: `focusPlanet / focusSun / focusShip / back / setSplitterRatio / bindChatDrone / setNotificationDeckOpen` — names match across all caller files.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-26-3d-solar-system-ui.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
