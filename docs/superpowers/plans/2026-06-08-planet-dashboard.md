# Planet Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder DASHBOARD tab in the Star View with a live overview of all registered planets arranged in a circle (≤8) or grid (>8), each panel showing the planet's texture, name, and one of three states: idle, running (blue glow + orbiting dot), or pending notification (orange pulsing glow).

**Architecture:** A new `PlanetDashboard` component lives in the HUD layer and wires together existing hooks (`usePlanets`, `useFeaturesMap`, `useNotificationRows`). Pure layout/state utilities are exported for unit testing. CSS handles all animation — no JS timers needed.

**Tech Stack:** React + TypeScript, Tailwind CSS, custom CSS (`glass.css`), Vitest, existing hooks from `socketStore` / `uiStore`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/client/components/glass/glass.css` | Add `.planet-panel`, `.planet-panel--running`, `.planet-panel--pending`, `@keyframes pending-pulse`, `.planet-orb`, `@keyframes orbit-border` |
| Create | `src/client/components/hud/PlanetDashboard.tsx` | Exported pure utilities (`getCircleRadius`, `getPlanetState`), `PlanetPanel` sub-component, `PlanetDashboard` main component |
| Create | `src/client/components/hud/PlanetDashboard.test.ts` | Unit tests for `getCircleRadius` and `getPlanetState` |
| Modify | `src/client/components/hud/SunPanel.tsx` | Import `PlanetDashboard`, replace `DashboardTab` body |

---

## Task 1: CSS — panel states + orbiting dot animation

**Files:**
- Modify: `src/client/components/glass/glass.css`

- [ ] **Add the following block to the bottom of `glass.css`**

```css
/* ─── Planet Dashboard ──────────────────────────────────────── */

.planet-panel {
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(12px) saturate(1.15);
  -webkit-backdrop-filter: blur(12px) saturate(1.15);
  border: 1px solid rgba(125, 211, 252, 0.30);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.10),
    0 4px 16px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(125, 211, 252, 0.12),
    0 0 20px rgba(56, 189, 248, 0.12);
  transition: filter 0.15s;
}
.planet-panel:hover { filter: brightness(1.2); }

.planet-panel--running {
  border-color: rgba(125, 211, 252, 0.55);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.10),
    0 4px 16px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(125, 211, 252, 0.30),
    0 0 30px rgba(56, 189, 248, 0.40),
    0 0 60px rgba(56, 189, 248, 0.18);
}

.planet-panel--pending {
  border-color: rgba(251, 146, 60, 0.85);
  animation: pending-pulse 2s ease-in-out infinite;
}

@keyframes pending-pulse {
  0%, 100% {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.10),
      0 4px 16px rgba(0, 0, 0, 0.55),
      0 0 28px 4px rgba(251, 146, 60, 0.75),
      0 0 55px rgba(251, 146, 60, 0.50);
  }
  50% {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.10),
      0 4px 16px rgba(0, 0, 0, 0.55),
      0 0 40px 6px rgba(251, 146, 60, 0.95),
      0 0 80px rgba(251, 146, 60, 0.65);
  }
}

/* Orbiting dot — travels clockwise around the 150×150 panel border */
@keyframes orbit-border {
  from { offset-distance: 0%; }
  to   { offset-distance: 100%; }
}

.planet-orb {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  /* Fade to transparent-cyan (not #00000000) to avoid the dark ring artifact */
  background: radial-gradient(circle, #38bdf8ff 0%, #38bdf8aa 40%, #38bdf800 100%);
  transform: translate(-50%, -50%);
  /* Rounded-rect path matching border-radius: 16px on a 150×150 element */
  offset-path: path('M 16 0 L 134 0 Q 150 0 150 16 L 150 134 Q 150 150 134 150 L 16 150 Q 0 150 0 134 L 0 16 Q 0 0 16 0 Z');
  animation: orbit-border 3s linear infinite;
  pointer-events: none;
  z-index: 10;
}
```

- [ ] **Commit**

```bash
git add src/client/components/glass/glass.css
git commit -m "feat(dashboard): planet panel CSS states + orbiting dot animation"
```

---

## Task 2: Pure utilities + tests (TDD)

**Files:**
- Create: `src/client/components/hud/PlanetDashboard.tsx`
- Create: `src/client/components/hud/PlanetDashboard.test.ts`

- [ ] **Create `PlanetDashboard.test.ts` with failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { getCircleRadius, getPlanetState, PANEL_SIZE, PANEL_GAP } from './PlanetDashboard'

describe('getCircleRadius', () => {
  it('returns minimum 220 for small counts', () => {
    expect(getCircleRadius(1)).toBe(220)
    expect(getCircleRadius(2)).toBe(220)
  })

  it('grows beyond 220 when 8 panels would overlap at minimum', () => {
    // circumference = 8 * (150 + 28) = 1424 → r ≈ 226.6 > 220
    expect(getCircleRadius(8)).toBeGreaterThan(220)
  })

  it('is monotonically non-decreasing for counts 1–8', () => {
    let prev = getCircleRadius(1)
    for (let n = 2; n <= 8; n++) {
      const cur = getCircleRadius(n)
      expect(cur).toBeGreaterThanOrEqual(prev)
      prev = cur
    }
  })

  it('uses PANEL_SIZE and PANEL_GAP constants in its formula', () => {
    // For count=9 the formula should dominate over the 220 minimum
    const circumference = 9 * (PANEL_SIZE + PANEL_GAP)
    const expected = circumference / (2 * Math.PI)
    expect(getCircleRadius(9)).toBeCloseTo(expected, 5)
  })
})

describe('getPlanetState', () => {
  it('returns idle when planet has no features and is not pending', () => {
    expect(getPlanetState(1, new Map(), new Set())).toBe('idle')
  })

  it('returns idle when all features are complete', () => {
    const features = new Map([[1, [{ status: 'complete' }, { status: 'failed' }]]])
    expect(getPlanetState(1, features, new Set())).toBe('idle')
  })

  it('returns running when any feature has status running', () => {
    const features = new Map([[1, [{ status: 'complete' }, { status: 'running' }]]])
    expect(getPlanetState(1, features, new Set())).toBe('running')
  })

  it('returns pending when planet id is in the pending set', () => {
    expect(getPlanetState(1, new Map(), new Set([1]))).toBe('pending')
  })

  it('pending takes priority over running', () => {
    const features = new Map([[1, [{ status: 'running' }]]])
    expect(getPlanetState(1, features, new Set([1]))).toBe('pending')
  })

  it('returns idle when planet id is not in features map', () => {
    const features = new Map([[2, [{ status: 'running' }]]])
    expect(getPlanetState(99, features, new Set())).toBe('idle')
  })
})
```

- [ ] **Run tests — expect them to fail (module not found)**

```bash
npx vitest run src/client/components/hud/PlanetDashboard.test.ts
```

Expected: `Error: Cannot find module './PlanetDashboard'`

- [ ] **Create `PlanetDashboard.tsx` with only the exported utilities** (no React yet)

```tsx
// src/client/components/hud/PlanetDashboard.tsx

export const PANEL_SIZE = 150
export const PANEL_GAP = 28
export const MAX_CIRCLE = 8

export type PlanetState = 'idle' | 'running' | 'pending'

export function getCircleRadius(count: number): number {
  const circumference = count * (PANEL_SIZE + PANEL_GAP)
  return Math.max(220, circumference / (2 * Math.PI))
}

export function getPlanetState(
  planetId: number,
  features: Map<number, { status: string }[]>,
  pendingPlanetIds: Set<number>,
): PlanetState {
  if (pendingPlanetIds.has(planetId)) return 'pending'
  if (features.get(planetId)?.some((f) => f.status === 'running')) return 'running'
  return 'idle'
}
```

- [ ] **Run tests — expect them to pass**

```bash
npx vitest run src/client/components/hud/PlanetDashboard.test.ts
```

Expected: all 9 tests pass.

- [ ] **Commit**

```bash
git add src/client/components/hud/PlanetDashboard.tsx \
        src/client/components/hud/PlanetDashboard.test.ts
git commit -m "feat(dashboard): planet state + circle radius utilities with tests"
```

---

## Task 3: `PlanetPanel` sub-component

**Files:**
- Modify: `src/client/components/hud/PlanetDashboard.tsx`

- [ ] **Add imports and `PlanetPanel` to `PlanetDashboard.tsx`**

Add at the top of the file (after the existing exports):

```tsx
import type { PlanetSummary } from '../../../core/types'
import { getPlanetTexturePath } from '../../scene/lib/planetTextures'
import { derivePlanetParams } from '../../scene/lib/planetParams'

interface PlanetPanelProps {
  planet: PlanetSummary
  state: PlanetState
  onClick: () => void
}

function PlanetPanel({ planet, state, onClick }: PlanetPanelProps) {
  const texturePath = getPlanetTexturePath(
    planet.name,
    derivePlanetParams(planet.name).surfaceType,
  )
  return (
    <button
      type="button"
      onClick={onClick}
      title={planet.name}
      style={{ width: PANEL_SIZE, height: PANEL_SIZE }}
      className={`planet-panel relative flex flex-col items-center justify-center gap-2 rounded-2xl cursor-pointer pointer-events-auto${
        state === 'pending'
          ? ' planet-panel--pending'
          : state === 'running'
            ? ' planet-panel--running'
            : ''
      }`}
    >
      {state === 'running' && <div className="planet-orb" />}
      <img
        src={texturePath}
        alt={planet.name}
        draggable={false}
        className="w-[90px] h-[90px] rounded-full object-cover"
        style={{ boxShadow: '0 0 12px rgba(0,0,0,0.6)' }}
      />
      <span
        className="text-[11px] tracking-wide truncate px-2 max-w-full text-center"
        style={{ color: '#cbd5e1' }}
      >
        {planet.name}
      </span>
    </button>
  )
}
```

- [ ] **Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add src/client/components/hud/PlanetDashboard.tsx
git commit -m "feat(dashboard): PlanetPanel sub-component with texture + state styling"
```

---

## Task 4: `PlanetDashboard` main component

**Files:**
- Modify: `src/client/components/hud/PlanetDashboard.tsx`

- [ ] **Append the `PlanetDashboard` export to `PlanetDashboard.tsx`**

```tsx
import { useUiStore } from '../../state/uiStore'
import { usePlanets, useFeaturesMap } from '../../state/socketStore'
import { useNotificationRows } from './useNotificationRows'

export function PlanetDashboard() {
  const planets = usePlanets()
  const features = useFeaturesMap()
  const notifRows = useNotificationRows()
  const focusPlanet = useUiStore((s) => s.focusPlanet)

  const pendingPlanetIds = new Set(notifRows.map((r) => r.planetId))

  if (planets.length === 0) {
    return (
      <p className="text-sm text-slate-500 mt-4">
        No projects yet — create one with the + button.
      </p>
    )
  }

  // Grid layout for more than MAX_CIRCLE planets
  if (planets.length > MAX_CIRCLE) {
    return (
      <div className="flex flex-wrap gap-4 justify-center pt-4">
        {planets.map((p) => (
          <PlanetPanel
            key={p.id}
            planet={p}
            state={getPlanetState(p.id, features, pendingPlanetIds)}
            onClick={() => focusPlanet(p.id)}
          />
        ))}
      </div>
    )
  }

  // Single planet — just center it
  if (planets.length === 1) {
    return (
      <div className="flex justify-center pt-8">
        <PlanetPanel
          planet={planets[0]!}
          state={getPlanetState(planets[0]!.id, features, pendingPlanetIds)}
          onClick={() => focusPlanet(planets[0]!.id)}
        />
      </div>
    )
  }

  // Circle layout for 2–MAX_CIRCLE planets
  const r = getCircleRadius(planets.length)
  const containerSize = 2 * r + PANEL_SIZE + 32
  const center = containerSize / 2

  return (
    <div
      className="flex justify-center items-center w-full"
      style={{ minHeight: containerSize }}
    >
      <div className="relative" style={{ width: containerSize, height: containerSize }}>
        {planets.map((p, i) => {
          const angle = (i / planets.length) * 2 * Math.PI - Math.PI / 2
          const x = center + r * Math.cos(angle) - PANEL_SIZE / 2
          const y = center + r * Math.sin(angle) - PANEL_SIZE / 2
          return (
            <div key={p.id} style={{ position: 'absolute', left: x, top: y }}>
              <PlanetPanel
                planet={p}
                state={getPlanetState(p.id, features, pendingPlanetIds)}
                onClick={() => focusPlanet(p.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Run existing tests to ensure nothing regressed**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Commit**

```bash
git add src/client/components/hud/PlanetDashboard.tsx
git commit -m "feat(dashboard): PlanetDashboard circle/grid layout component"
```

---

## Task 5: Wire into the DASHBOARD tab

**Files:**
- Modify: `src/client/components/hud/SunPanel.tsx`

- [ ] **Add the import at the top of `SunPanel.tsx`**

```tsx
import { PlanetDashboard } from './PlanetDashboard'
```

- [ ] **Replace the `DashboardTab` function body**

Find and replace:

```tsx
function DashboardTab() {
  return (
    <div className="text-sm text-slate-300">
      All-projects overview lands as a Phase 14 polish.
    </div>
  )
}
```

With:

```tsx
function DashboardTab() {
  return <PlanetDashboard />
}
```

- [ ] **Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Start the dev server and open the star view**

```bash
npm run dev
```

1. Open `http://localhost:5173`
2. Click the star → DASHBOARD tab is selected by default
3. Verify planet panels appear in a circle (or "No projects yet" message if none exist)
4. If projects exist: check idle/running/pending states render with correct glows
5. Click a planet panel — should navigate to that planet's focused view
6. Verify the orbiting dot animates clockwise on any running planet

- [ ] **Run full test suite one final time**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Commit**

```bash
git add src/client/components/hud/SunPanel.tsx
git commit -m "feat(dashboard): wire PlanetDashboard into DASHBOARD tab"
```
