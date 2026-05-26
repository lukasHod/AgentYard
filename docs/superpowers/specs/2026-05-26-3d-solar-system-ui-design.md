# 3D Solar System UI — Design

Spec produced via the `obra/superpowers` brainstorming methodology. Decisions confirmed iteratively in conversation; glass HUD style B selected via the visual companion; design presented in sections and approved.

## Context

Today AgentYard ships a 2D `ships` view (PixiJS galaxy + dock), a `run` console (workflow execution graph + drone transcripts), and an `editor` view (xyflow workflow editor) — three top-level tabs. The "ship" metaphor in the data model is overloaded: it represents the project itself. The user's request is to commit fully to the spatial metaphor by going 3D, with a clean separation between project (planet), feature (ship), and agent session (drone), so that working on several features in parallel becomes visually navigable.

The redesign replaces the entire top-level UI with a single React Three Fiber scene + glass HUD overlay. The current single-global workflow model is preserved as-is for this spec; the larger workflow model overhaul (per-planet workflows, adopt-with-link, leader-picks-workflow, per-planet skills/agents) is intentionally split into a follow-up spec so the 3D work can land independently.

## Scope

**In:**
- Three-level 3D scene: solar system → planet → ship, with cinematic dolly transitions.
- A new "feature = ship" + "drone session = drone" 3D representation.
- Glass HUD overlay (style B, frosted + outer glow halo) — ambient when zoomed out, full-screen when a planet/ship is focused.
- Always-visible notification deck that can deep-link from any LOD to a specific drone's chat.
- Procedural planet appearance (deterministic from project name), with a placeholder "customize" entry point for the follow-up spec.
- Ship visualization from a Kenney CC0 GLB library (~25 hulls), name-hashed + color-tinted.
- Removal of the `ships` / `run` / `editor` top-level tab system.
- Removal of all PixiJS code paths (`GameCanvas`, `GameHud`, `galaxyScene`, `dockScene`).

**Out of scope (logged as follow-ups):**
- **Workflow model overhaul** (per-planet workflows, adopt-with-link semantics, per-planet skills/agents, leader-picks-workflow). Separate spec — UI redesign keeps today's single-global workflow.
- **Planet appearance customization UI** — wired structurally so a future "Customize" panel can override the procedural defaults, but the panel itself is not built in this spec.
- **Schema rename `ship` → `planet`** — the DB column and types keep the `ship` name during this spec to avoid churn. The 3D layer talks about planets internally; types still say `ShipSummary`.

## Locked decisions

| Decision | Choice |
|---|---|
| Top-level view | Single 3D scene (no more `ships` / `run` / `editor` tabs) |
| Sun vs planet IA | Sun = global (tools, agents, MCPs, workflows, dashboard); planet = local (chat, features, plans, description, project-scoped tools) |
| Default-view HUD | Ambient HUD with pending count, running-projects strip, top-bar actions |
| Sun zoom | Clicking the sun behaves the same as clicking a planet (LOD 1 with full-screen panel + sun as background) |
| Camera | Cinematic dolly fly-in (~0.8s, easeInOutCubic); spline curve for multi-step jumps |
| Planet identity | Procedural-by-name (size, palette, surface type, atmosphere, rotation); "customize" planned for follow-up |
| Glass style | B (frosted, rounded, sans-serif) with stronger outer-glow border halo |
| 3D library | React Three Fiber + drei + `@react-three/postprocessing` |
| Panel layout | Full-screen HUD with planet as dimmed background; chat panel persistent on the right; info tabs panel on the left; top bar across; draggable splitter between info and chat (default 28% / 45%) |
| Live run | Conditional `RUN` tab on the planet panel — appears only while a feature is running on that planet |
| Workflow editor | Stays global (one workflow); button opens a full-screen glass overlay |
| Features as ships | Each active feature renders as a 3D ship near its parent planet |
| Ship models | Kenney CC0 GLB library (~25 hulls), hashed-by-feature-name → modelIndex + hueShift |
| Ship arrangement | Orbital ring at ~1.8× planet radius, ships evenly spaced, slow rotation (~2 RPM) |
| Ship lifecycle visual | Cyan flash + 1.5s fade on complete; rose flash + slower fade on fail; despawn cleanly |
| Drone models | Two GLB hulls — leader (larger, warm-orange accent) + regular (small, ship-tinted accent) |
| Drone clarification state | Red emissive + pulsing scale + floating `!` sprite |
| Notification deck | Always rendered top-right regardless of LOD; click → spline-fly to that drone's chat |
| Approach | Single feature branch from `main`; phased commits; no feature flag |

## Conceptual model

```
                  ┌─ LOD 0 — SOLAR SYSTEM ─┐
                  │   Sun                  │
                  │   Planets on orbits    │
                  │   Ships as dots        │
                  │   Ambient HUD          │
                  └────────────┬───────────┘
                               │ click planet
                               ▼
                  ┌─ LOD 1 — PLANET ───────┐
                  │   Planet (background)  │
                  │   Ship orbital ring    │
                  │   Drones around ships  │
                  │   Full-screen HUD      │
                  │     ├── top bar        │
                  │     ├── info panel     │
                  │     ├── chat panel     │
                  │     └── notif deck     │
                  └────────────┬───────────┘
                               │ click ship
                               ▼
                  ┌─ LOD 2 — SHIP ─────────┐
                  │   Ship (background)    │
                  │   Drones orbiting      │
                  │   Full-screen HUD      │
                  │     ├── feature info   │
                  │     ├── workflow vis   │
                  │     ├── leader chat    │
                  │     └── notif deck     │
                  └────────────────────────┘

Notification deck (always-on across all LODs) can spline-fly
to any (planet, ship, drone) in a single ~1.2s motion.
```

## Visual language

**Glass style B tokens** (the actual values, used everywhere):

```css
/* Panel surface */
background: rgba(15, 23, 42, 0.35);          /* slate-900 @ 35% */
backdrop-filter: blur(18px) saturate(1.15);
border: 1px solid rgba(125, 211, 252, 0.30); /* sky-300 @ 30% */
border-radius: 16px;
box-shadow:
  inset 0 1px 0 rgba(255, 255, 255, 0.10),   /* inner top highlight */
  0 8px 32px rgba(0, 0, 0, 0.55),            /* drop shadow */
  0 0 0 1px rgba(125, 211, 252, 0.20),       /* border emphasis */
  0 0 60px rgba(56, 189, 248, 0.28);         /* outer glow halo */

/* Typography */
font-family: ui-sans-serif, system-ui, sans-serif;
/* Monospace reserved for: project path, git SHA, README pre blocks */

/* Status palette */
--running:  #38bdf8   /* sky-400 */
--complete: #4ade80   /* green-400 */
--idle:     #94a3b8   /* slate-400 */
--failed:   #fb7185   /* rose-400 */
--leader:   #fb923c   /* orange-400 — drone leader emissive */
--alert:    #f43f5e   /* rose-500 — pending-clarification drone emissive */
```

**Glass primitives** (new, in `src/client/components/glass/`):

| Component | Role |
|---|---|
| `<GlassPanel>` | Main container (info panel, chat panel, overlays). Frosted blur + outer glow border. |
| `<GlassChip>` | Small status badge — running / complete / idle / failed. |
| `<GlassButton>` | Pill button: variants `primary` (filled tint), `ghost` (outline). |
| `<GlassTab>` | Tab control with active-glow ring. |
| `<GlassSplitter>` | Vertical drag-handle between info and chat panels. |
| `<NotificationDeck>` | Auto-collapsing pill stack used for clarifications. |

## Architecture

**Top-level component tree:**

```
<App>
  <Canvas>                              ← R3F canvas, fills window (pointer-events: auto)
    <SolarSystemScene>
      <Stars />                         ← drei <Stars/>, slow parallax
      <Sun />                           ← procedural shader sphere + corona
      {planets.map(p => (
        <Planet planet={p}>
          {p.activeFeatures.map(f => (
            <Ship feature={f}>
              {f.drones.map(d => <Drone drone={d} />)}
            </Ship>
          ))}
        </Planet>
      ))}
      <CameraRig />                     ← owns dolly + spline transitions
      <EffectComposer>                  ← bloom + light vignette
    </SolarSystemScene>
  </Canvas>

  <HUDLayer>                            ← absolute-positioned React DOM on top
    {focus.lod === 0 && <AmbientHUD/>}
    {focus.lod >= 1 && <FocusedPanel focus={focus}/>}
    <NotificationDeck/>                 ← always rendered
    {workflowEditorOpen && <WorkflowEditorOverlay/>}
    {/* toasts, modals */}
  </HUDLayer>
</App>
```

**Why split scene + HUD this cleanly.** Same pattern that exists today between `GameCanvas` (PixiJS) and `GameHud` (React DOM). The 3D layer owns spatial things — planet positions, ship orbits, drone bobbing, camera, lighting. The HUD layer is plain React + Tailwind and never imports Three.js. The only state they share is the `focus` slice (see Data flow below).

## 3D scene structure

**Sun.** Procedural shader sphere ~3× a planet's radius, with a bloom-driven corona. Slow surface rotation. Click target — selecting the sun moves focus to a special "sun" state where the panel content is the global library / dashboard.

**Planets.** One per project (`ShipSummary`). Procedural sphere with a custom material — see "Procedural planets" below. Each planet sits on a fixed orbital ring around the sun; orbit assignment is `index → ring (n)`. Planets rotate on their own axis at the rate derived from their hash. At LOD 0 they're at full detail; at LOD 1 the focused planet renders 1.5× larger relative to viewport.

**Ships.** One per active feature (`FeatureSummary`). GLB model from the library (see "Ship & drone system"). Positioned on an orbital ring at ~1.8× planet radius. Render only at LOD ≥ 1 — at LOD 0, ships show as small emissive dots near each planet (impostor sprites; no GLB cost until you zoom in).

**Drones.** One per `SessionDescriptor` with `role: 'drone' | 'leader'` that belongs to a currently-running feature. Drones cluster around their ship with small radius orbits + slight vertical bob. Render only at LOD ≥ 1.

**Lighting.** Single directional light from the sun's position + low-level ambient. Bloom post-process catches emissive materials (planet atmospheres, drone glow, sun corona).

**Postprocessing pipeline** (`@react-three/postprocessing`): Bloom + slight vignette. Tone mapping ACES. No DoF (looks expensive, low payoff here).

## Camera & LOD

Three discrete LODs, all reachable by cinematic dolly. The `<CameraRig />` owns a tween-driven target position + look-at vector. Default duration **0.8s** with `easeInOutCubic`. Interrupting a transition snaps to a new curve from the current camera state.

| LOD | Framing | What renders |
|---|---|---|
| **0 — System** | Wide, sun centered, all planet orbits visible | sun + planets at full detail; ships as impostor dots; drones not rendered |
| **1 — Planet** | Planet large in background, ship orbital ring in front | one planet + that planet's ships at full detail + all drones |
| **2 — Ship** | Ship dominates background, drones orbiting it | one ship + its drones at full detail; planet + other ships dimmed in periphery |

**Backing out:** `Esc` / `← system` chip / click outside any panel — each pops one LOD level (ship → planet → system). Double-Esc fully exits to system.

**Notification jumps.** Clicking a notification can require system → planet → ship → open chat in one move. The rig handles this as a single spline curve through the three target positions instead of three discrete tweens, so it reads as one continuous ~1.2s motion. The chat panel rebinds to the target drone at the end of the curve.

**Interrupted transitions.** If the user clicks another planet mid-fly, the rig recomputes the curve from the current state and proceeds — no jitter, no waiting for the previous tween to finish.

## Procedural planets

Deterministic per-project. `hash(project.name)` derives:

| Param | Source | Range |
|---|---|---|
| `radius` | `hash[0..1]` mapped | 0.8–1.2 units |
| `surfaceType` | `hash[2..3]` mod 7 | `rocky` / `gas` / `lava` / `ice` / `ocean` / `crystal` / `ringed` |
| `paletteHue` | `hash[4..5]` | 0–360° |
| `atmosphereColor` | `paletteHue` + 30° | — |
| `rotationSpeed` | `hash[6]` | 0.3–1.0 rev/min |
| `hasRing` | `surfaceType === 'ringed'` OR `hash[7]` < 10% | bool |

Surface types are implemented as shader variants on a shared `<PlanetMaterial>` — uniforms (palette, noise seed, atmosphere) differ; vertex/fragment programs share a base. Same project name → same planet on every machine.

**Broken-path planets** (`pathExists: false`): same procedural identity, but desaturated palette + a red emissive crackle overlay shader. Hovers/tooltips say "path missing." Same data semantics as today.

**Customize hook:** the `<Planet/>` component accepts an optional `override` prop that, if present, replaces individual derived params. The override storage and UI for editing it are explicitly **out of scope** for this spec — the prop and the loading code path are stubbed in so the follow-up spec can wire them up without restructuring.

## Ship & drone system

**Ship model selection.** On feature creation (or first render of an existing feature):

```ts
const seed = hashStringToInt(`${feature.id}:${feature.name}`)
const modelIndex = seed % 25
const hueShift  = (seed >> 8) % 360
```

Stored as derived values on the feature in memory, not persisted. `useGLTF('/models/ships/00..24.glb')` with drei `preload`. A material override applies `hueShift` via an HSL rotation on the base color + tinted emissive accent. Same feature ID always renders the same ship.

**Model source.** Kenney's Space Kit (CC0). Files committed to `public/models/ships/` as DRACO-compressed GLB. License attribution noted in `THIRD_PARTY_LICENSES.md` even though CC0 doesn't require it.

**Ship orbital ring.** Each planet has its own ring at ~1.8× planet radius. N active ships → evenly distributed angles, rotating at ~2 RPM. When N changes (feature added/removed):
- New ship spawns at its target angle with a 400ms fade-in.
- Removed ship despawns with the lifecycle animation (see below).
- Remaining ships smoothly tween to their new angles (~400ms easeInOut).

**Drone models.** Two GLB hulls — `drone-leader.glb` (larger, ~1.4× the regular size, distinct silhouette) and `drone-regular.glb` (small generic drone). Drei `useGLTF` preload.

**Drone behavior.** Drones orbit their ship at small radius with a sine-wave vertical bob. Slight randomized phase per drone so they don't all bob in lockstep. Spawn: 0.4s fade-in. Despawn: arcs away from the ship + fades.

**Drone visual states.**

| State | Visual |
|---|---|
| **Idle / running** | Steady accent glow, small thruster trail |
| **Pending clarification** | Body emissive switches to `--alert` (rose-500); scale pulses `1.0 ↔ 1.15` over 1s; floating `!` sprite billboard above; thruster brightens |
| **Finished** | Brief flash → fade → despawn |

Leader-specific: warm-orange (`--leader`) emissive accent + a small downward-pointing spotlight cone so it reads as "in charge."

**Ship lifecycle on feature complete/fail.**
- **Complete:** cyan flash → 1.5s fade-out. Drones despawn first (200ms stagger).
- **Fail:** rose flash → 2.0s fade-out, slower and darker.
- After fade: the ship is removed; remaining ships re-distribute on the ring.
- If the user is at LOD 2 on the ship that finished, focus auto-pops to LOD 1 (its planet) after the fade.

**Interaction targets.**
- **Click planet (LOD 0):** cinematic zoom to LOD 1 on that planet.
- **Click ship (LOD 1):** cinematic zoom to LOD 2 on that ship.
- **Click drone (LOD 2 only):** rebinds the chat panel to that drone session; no camera move. Drones are not reliably clickable at LOD 1 — they're small at that distance. Drone selection at LOD 1 happens via the notification deck or by zooming to the ship first.
- **Click sun (LOD 0):** zoom to LOD 1 sun-special state (global library / dashboard in the info panel; sun rendered as background).

## HUD layer

### Ambient HUD (LOD 0 only)

```
┌─ TOP BAR ────────────────────────────────────────────────┐
│  ● AGENTYARD                       3 pending  🔊  + new  │
└──────────────────────────────────────────────────────────┘



                       [solar system]



┌─ BOTTOM STRIP ───────────────────────────────────────────┐
│  ● AgentYard / add-payment-flow   ● HRX / fix-login-bug │
└──────────────────────────────────────────────────────────┘
```

- **Top-left:** `AGENTYARD` mark + connection dot.
- **Top-right:** pending count (click → opens notification deck full); mute toggle; `+ new project` button.
- **Bottom strip:** one chip per project that has a currently-running feature. Chip = `project / feature` + pulsing dot. Click → cinematic zoom to that planet, opens the planet's CHAT tab on that feature's leader.

### Focused panel (LOD 1 and LOD 2)

```
┌──────────────────────────────────────────────────────────────┐
│ [← system]  ● PLANET NAME      /Users/...   ⚙ wf  ✕ delete │  top bar
├────────────────────────┬─────────────────────────────────────┤
│  [FEAT][TOOLS][PLANS]  │           CHAT TERMINAL              │
│  [DESC] (and [RUN] if  │                                      │
│  a feature is running) │  > help me                           │
│                        │  • analysing                         │
│  feature/tool/plan     │  ● awaiting clarification …          │
│  list (scrolls)        │                                      │
│                        │  [type here]                         │
│  ▷ new feature         │                                      │
└────────────────────────┴─────────────────────────────────────┘
                  ↑ draggable splitter ↑

  [planet at LOD 1 / ship at LOD 2 — dimmed background visual]
```

- **Default split:** info panel ~28% width, chat panel ~45% (matching the user-preferred mockup). User can drag the `<GlassSplitter>` between them; the position persists in `localStorage`.
- **Background:** the focused planet/ship is rendered behind both panels with `brightness(0.55)` baseline; on hover over the splitter, brightness lifts to 0.65 momentarily.
- **Top bar:** `← system` (one LOD up), project/feature name, project path, workflow editor button, delete (planet-level only).
- **Info panel tabs (LOD 1 — planet):** FEATURES / TOOLS / PLANS / DESCRIPTION + conditional RUN tab.
- **Info panel content (LOD 2 — ship):** feature description, workflow progression (read-only xyflow at small size), drone list.
- **Chat panel:** always visible while focused. Bound to whichever session is currently selected — leader of the focused ship at LOD 2; the planet's ambient ship-chat session at LOD 1.

### Notification deck (always rendered, all LODs)

Top-right, below the top-bar pending count. Frosted glass pill that auto-expands when there's ≥1 pending clarification. Each row:

```
[planet-color dot]  Planet · Feature · drone-role
"Should refunds be partial?"                              [→]
```

Click `[→]` (or anywhere on the row) → spline-fly to LOD 2 on that ship → bind chat panel to that drone. The chime (`playClarificationChime`) fires on new entries. When the user opens a drone chat that's pending, that row leaves the deck.

Sort: newest first. On empty deck, the pill collapses to "0 pending" and dims.

### Workflow editor overlay

Triggered from the planet panel's top-bar `⚙ workflow editor` button or from the sun's WORKFLOWS tab. A `<GlassPanel>` that fills ~90% of the viewport. Behind it, the solar system keeps animating but dimmed/blurred via the overlay's own `backdrop-filter`. xyflow lives inside with a dark transparent background. `Esc` or `X` closes; dirty-state prompts before close.

## Data flow & state

Two new pieces of UI state in Zustand (`useUiStore`, new file alongside `socketStore`):

```ts
type Focus =
  | { lod: 0 }
  | { lod: 1, planetId: number }
  | { lod: 1, sun: true }
  | { lod: 2, planetId: number, shipFeatureId: number, chatDroneId?: string }

type UiState = {
  focus: Focus
  setFocus(target: Focus): void
  splitterRatio: number           // 0.0..1.0, persisted to localStorage
  setSplitterRatio(r: number): void
  notificationDeckOpen: boolean
  setNotificationDeckOpen(open: boolean): void
}
```

The camera rig subscribes to `focus`. Transitions are computed from `(currentFocus, nextFocus)` and animated by the rig — components don't tween anything themselves.

Procedural planet/ship/drone params are derived selectors (pure functions of name/id). No persistence in this spec.

**No backend changes.** All current socket events (`session:added`, `session:state`, `clarification:pending`, `feature:status`, `ship:added`, `ship:deleted`) drive the new scene unchanged. The new components subscribe to the existing store slices.

## Migration / deletion plan

Files added:
- `src/client/scene/` — new directory for R3F scene components (SolarSystemScene, Sun, Planet, Ship, Drone, CameraRig, PlanetMaterial, etc.)
- `src/client/components/glass/` — new directory for glass primitives.
- `src/client/components/hud/` — new directory for AmbientHUD, FocusedPanel, NotificationDeck, WorkflowEditorOverlay.
- `src/client/state/uiStore.ts` — new Zustand store for focus + UI prefs.
- `public/models/ships/00..24.glb`, `public/models/drones/leader.glb`, `public/models/drones/regular.glb` — Kenney assets.
- `THIRD_PARTY_LICENSES.md` — license attribution.

Files deleted (after the new path is wired and verified):
- `src/client/canvas/GameCanvas.tsx`, `GameHud.tsx`, `Modal.tsx`, `ChatModal.tsx`, `galaxyScene.ts`, `dockScene.ts`, `useGameHud.ts`.
- `src/client/views/RunView.tsx`, `EditorView.tsx` (as top-level views — their internals are reused inside overlays and the planet RUN tab).
- The `ViewMode` / `view` / `visited` machinery in `App.tsx`.
- The chrome at the top of `App.tsx` (the `ships | run | editor` header).

Dependencies removed: `pixi.js`, `@pixi/react`.
Dependencies added: `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`.

## Error handling & edge cases

- **WebGL 2 unsupported / context lost.** Detect at mount; fall back to a static glass card: "AgentYard requires WebGL 2." No 2D fallback — the spatial metaphor is the app.
- **GLB load failure.** Show a "ghost" placeholder (gray emissive cube with `?` sprite). Log to console. Don't block the rest of the scene.
- **Broken planet path** (`pathExists: false`). Render with desaturated palette + red crackle overlay; tooltip "path missing"; planet panel renders today's `PATH MISSING` warning unchanged.
- **High ship count** (>12 active on one planet). Ring still works; ships shrink slightly to avoid overlap. Soft cap at 16 visible; rest in a "queued" overflow chip in the planet's FEATURES tab footer.
- **Long names.** Truncate in HUD with ellipsis; full name in tooltip.
- **Dirty workflow editor + Esc.** Confirm dialog before close.
- **Notification deep-link to a drone that just despawned** (race between user click and feature-complete event). The spline-fly aborts at LOD 2 with a toast: "That drone has finished — no chat to open."
- **Splitter at extreme values.** Clamp to `[0.15, 0.85]` so neither panel can fully disappear.

## Testing strategy

- **Pure logic tests (vitest):**
  - `hashStringToInt` and the derived param mappings (planet → palette/surface; feature → modelIndex/hueShift).
  - The orbital layout function (N ships → N evenly distributed angles).
  - The `focus` reducer (legal LOD transitions; reject LOD 2 on a feature that's no longer running).
- **R3F component tests** (`@react-three/test-renderer`): thin smoke tests — mount `<Planet/>`, assert mesh + material uniforms; mount `<Ship/>`, assert the hueShift uniform is set; mount `<Drone state="pending" />`, assert emissive material is the alert color.
- **No snapshot testing.** 3D snapshots are flaky and offer little signal.
- **Manual visual verification via Chrome MCP.** Use the `mcp__chrome-devtools__*` tools to launch the dev server (`npm run dev`), open the page, drive flows (click planet → zoom; click ship; trigger a pending clarification; click notification → assert chat opens), and capture screenshots at each LOD. This is the bar for the look-and-feel work, replacing manual eyeballing for at least the core flows.
- **CI does not run Chrome MCP** — visual verification stays local. Vitest + typecheck remain the CI gate.

## Open questions / future work

- **Workflow model overhaul** — separate spec. Per-planet workflows, adopt-with-link, leader picks workflow at task start, per-planet skills/agents.
- **Planet appearance customization UI** — the `override` prop is stubbed in; the UI is the follow-up.
- **Schema rename `ship` → `planet`** — deferred. The 3D layer talks about planets internally; types still say `ShipSummary`. A future cleanup can rename DB columns and TypeScript types in lockstep.
- **Multi-window support** (one window per project) — not in scope. The 3D layer assumes a single window.
- **Performance tuning for very large project counts (>50)** — not in scope. The architecture supports it (impostor sprites at LOD 0; lazy GLB loads at LOD ≥ 1), but tuning is deferred until someone hits the wall.
