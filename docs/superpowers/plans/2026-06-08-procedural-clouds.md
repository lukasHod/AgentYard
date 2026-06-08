# Procedural Planet Clouds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, hash-baked procedural cloud layer to planets using a GLSL FBM noise shader, with per-planet cloud presence stored in the SQLite database at planet creation time.

**Architecture:** A new `CloudMaterial.tsx` registers a `<cloudMaterial>` JSX primitive (same pattern as `PlanetMaterial.tsx`) containing a full FBM cloud shader. The server computes `hasClouds` at planet creation and stores it in the DB; the client reads it from `PlanetSummary` and conditionally renders a thin transparent cloud sphere on top of the planet surface. The sphere rotates independently (15% faster than the planet) and morphs continuously via a time uniform.

**Tech Stack:** Three.js, React Three Fiber, `@react-three/drei` (`shaderMaterial`), better-sqlite3, vitest, Node.js built-in test runner.

---

## File Map

| File | Change |
|---|---|
| `src/server/db.ts` | Add `runAddHasCloudsMigration` + call it in `getDb` |
| `src/server/planets.ts` | Inline FNV-1a hash, add `pickHasClouds`, update `Planet`/`PlanetRow` types, update `createPlanet` INSERT and `rowToPlanet` |
| `src/server/planets.test.ts` | New — unit tests for `pickHasClouds` (Node test runner) |
| `src/core/types.ts` | Add `hasClouds: boolean` to `PlanetSummary` |
| `src/client/scene/CloudMaterial.tsx` | New — FBM cloud shader + `extend` registration |
| `src/client/scene/Planet.tsx` | Import `CloudMaterial`, add refs, useFrame additions, conditional cloud sphere JSX |
| `package.json` | Add `src/server/planets.test.ts` to `test:server` command |

---

## Task 1: DB Migration — add `has_clouds` column

**Files:**
- Modify: `src/server/db.ts`

- [ ] **Add `runAddHasCloudsMigration` function and call it in `getDb`**

  In `src/server/db.ts`, add after the existing `runAddTextureMigration` function (line 86) and call it in `getDb` (line 96):

  ```ts
  function runAddHasCloudsMigration(db: DB) {
    if (tableExists(db, 'planets') && !columnExists(db, 'planets', 'has_clouds')) {
      db.exec(`ALTER TABLE planets ADD COLUMN has_clouds INTEGER NOT NULL DEFAULT 0`)
    }
  }
  ```

  Then update `getDb` to call it after `runAddTextureMigration`:

  ```ts
  export function getDb(): DB {
    if (_db) return _db
    mkdirSync(DB_DIR, { recursive: true })
    const db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runRenameMigration(db)
    db.exec(SCHEMA)
    runAddTextureMigration(db)
    runAddHasCloudsMigration(db)
    _db = db
    return db
  }
  ```

- [ ] **Commit**

  ```bash
  git add src/server/db.ts
  git commit -m "feat(db): add has_clouds column migration"
  ```

---

## Task 2: Server — `pickHasClouds`, updated types, updated `createPlanet`

**Files:**
- Modify: `src/server/planets.ts`
- Create: `src/server/planets.test.ts`
- Modify: `package.json`

- [ ] **Write the failing test first**

  Create `src/server/planets.test.ts`:

  ```ts
  import { describe, it } from 'node:test'
  import assert from 'node:assert/strict'
  import { pickHasClouds } from './planets.js'

  describe('pickHasClouds', () => {
    it('is deterministic for the same name', () => {
      assert.equal(pickHasClouds('AgentYard'), pickHasClouds('AgentYard'))
    })

    it('gas planets never have clouds', () => {
      // Scan enough names to find a gas planet and verify it never gets clouds.
      let gasFound = false
      for (let i = 0; i < 500; i++) {
        const name = `probe-${i}`
        // Derive surface type using the same FNV-1a algorithm used in pickHasClouds.
        let h = 0x811c9dc5
        for (let j = 0; j < name.length; j++) {
          h ^= name.charCodeAt(j)
          h = Math.imul(h, 0x01000193) >>> 0
        }
        const surfaces = ['rocky', 'gas', 'lava', 'ice', 'ocean', 'crystal', 'ringed']
        const surfaceType = surfaces[((h >>> 8) & 0xff) % surfaces.length]
        if (surfaceType === 'gas') {
          assert.equal(pickHasClouds(name), false, `gas planet ${name} must not have clouds`)
          gasFound = true
        }
      }
      assert.ok(gasFound, 'expected to find at least one gas planet in 500 probes')
    })

    it('produces a mix of true and false across many planet names', () => {
      const results = Array.from({ length: 200 }, (_, i) => pickHasClouds(`planet-${i}`))
      assert.ok(results.some(Boolean), 'some planets should have clouds')
      assert.ok(results.some((v) => !v), 'some planets should not have clouds')
    })
  })
  ```

- [ ] **Add test file to `test:server` command in `package.json`**

  Find the `"test:server"` line and append `"src/server/planets.test.ts"` to the list of files:

  ```json
  "test:server": "node --import tsx --test \"src/core/executor.test.ts\" \"src/core/tools.test.ts\" \"src/server/runtime/scriptArgv.test.ts\" \"src/server/runtime/markCompleteGate.test.ts\" \"src/server/tools/crud.test.ts\" \"src/server/tools/lifecycle.test.ts\" \"src/server/tools/resolver.test.ts\" \"src/server/tools/scanCache.test.ts\" \"src/server/workflows.test.ts\" \"src/server/planets.test.ts\"",
  ```

- [ ] **Run test to confirm it fails**

  ```bash
  npm run test:server 2>&1 | grep -A3 "planets.test"
  ```

  Expected: error about `pickHasClouds` not being exported.

- [ ] **Implement `pickHasClouds` and update `planets.ts`**

  Replace the top of `src/server/planets.ts` (the imports + `TEXTURES` + `pickTexture` block) with the expanded version. Full file after changes:

  ```ts
  import { existsSync } from 'node:fs'
  import { simpleGit } from 'simple-git'
  import { createRepo } from './repository.js'

  const TEXTURES = [
    'Alpine', 'Gaseous1', 'Gaseous2', 'Gaseous3', 'Gaseous4',
    'Icy', 'Martian', 'Savannah', 'Swamp',
    'Terrestrial1', 'Terrestrial2', 'Terrestrial3', 'Terrestrial4',
    'Tropical', 'Venusian', 'Volcanic',
  ]

  function pickTexture(name: string): string {
    let h = 0
    for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0
    return TEXTURES[Math.abs(h) % TEXTURES.length]!
  }

  // FNV-1a 32-bit — mirrors src/client/scene/lib/hash.ts so surface type
  // derivation is identical on server and client.
  function fnv1a(s: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h >>> 0
  }

  function hashByte(h: number, i: number): number {
    return (h >>> (i * 8)) & 0xff
  }

  // Surface type order must match src/client/scene/lib/planetParams.ts exactly.
  const SURFACES = ['rocky', 'gas', 'lava', 'ice', 'ocean', 'crystal', 'ringed'] as const
  type SurfaceType = (typeof SURFACES)[number]

  // Maximum hashByte value (0–255) that results in clouds for each surface type.
  // hashByte(h2, 1) < threshold → has clouds.
  const CLOUD_THRESHOLDS: Record<SurfaceType, number> = {
    ocean:   192, // 75 %
    ice:     153, // 60 %
    rocky:   115, // 45 %
    ringed:   64, // 25 %
    crystal:  51, // 20 %
    lava:     26, // 10 %
    gas:       0, //  0 %
  }

  export function pickHasClouds(name: string): boolean {
    const h1 = fnv1a(name)
    // h2 uses the same derivation as deriveHash(h1, 'planet') in planetParams.ts
    const h2 = fnv1a('planet' + h1.toString(16))
    const surfaceType = SURFACES[hashByte(h1, 1) % SURFACES.length]!
    const threshold = CLOUD_THRESHOLDS[surfaceType]
    // byte 1 of h2 is independent of hasRing (which uses byte 0 of h2)
    return hashByte(h2, 1) < threshold
  }

  export interface Planet {
    id: number
    name: string
    projectPath: string
    workflowId: number | null
    state: string
    createdAt: number
    texture: string | null
    hasClouds: boolean
    /** Set by the read path — true if projectPath exists on disk right now. */
    pathExists: boolean
  }

  interface PlanetRow {
    id: number
    name: string
    project_path: string
    workflow_id: number | null
    state: string
    created_at: number
    texture: string | null
    has_clouds: number
  }

  function rowToPlanet(row: PlanetRow): Planet {
    return {
      id: row.id,
      name: row.name,
      projectPath: row.project_path,
      workflowId: row.workflow_id,
      state: row.state,
      createdAt: row.created_at,
      texture: row.texture,
      hasClouds: row.has_clouds === 1,
      pathExists: existsSync(row.project_path),
    }
  }

  const planets = createRepo<PlanetRow, Planet>(rowToPlanet)

  export function listPlanets(): Planet[] {
    return planets.all('SELECT * FROM planets ORDER BY created_at DESC')
  }

  export function getPlanet(id: number): Planet | undefined {
    return planets.one('SELECT * FROM planets WHERE id = ?', id)
  }

  export async function createPlanet(opts: {
    name: string
    projectPath: string
    workflowId?: number | null
  }): Promise<Planet> {
    if (!opts.name?.trim()) throw new Error('name required')
    if (!opts.projectPath?.trim()) throw new Error('project path required')
    if (!existsSync(opts.projectPath)) {
      throw new Error(`Project path does not exist: ${opts.projectPath}`)
    }
    const git = simpleGit(opts.projectPath)
    if (!(await git.checkIsRepo())) {
      throw new Error(`Project path is not a git repository: ${opts.projectPath}`)
    }

    const texture   = pickTexture(opts.name.trim())
    const hasClouds = pickHasClouds(opts.name.trim())
    const info = planets
      .db()
      .prepare(
        'INSERT INTO planets (name, project_path, workflow_id, state, created_at, texture, has_clouds) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(opts.name.trim(), opts.projectPath, opts.workflowId ?? null, 'idle', Date.now(), texture, hasClouds ? 1 : 0)
    return getPlanet(Number(info.lastInsertRowid))!
  }
  ```

  (Keep the `deletePlanet` and any functions below it unchanged — only the top section shown here changes.)

- [ ] **Run tests to confirm they pass**

  ```bash
  npm run test:server 2>&1 | grep -E "planets.test|pass|fail"
  ```

  Expected: all `pickHasClouds` tests pass.

- [ ] **Commit**

  ```bash
  git add src/server/planets.ts src/server/planets.test.ts package.json
  git commit -m "feat(server): bake hasClouds at planet creation with surface-type weighting"
  ```

---

## Task 3: Shared type — `PlanetSummary.hasClouds`

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Add `hasClouds` to `PlanetSummary`**

  In `src/core/types.ts`, add the field to `PlanetSummary` (line 53):

  ```ts
  export interface PlanetSummary {
    id: number
    name: string
    projectPath: string
    workflowId: number | null
    state: string
    createdAt: number
    texture: string | null
    hasClouds: boolean
    /** True if projectPath exists on disk (computed server-side at read time). */
    pathExists: boolean
  }
  ```

- [ ] **Verify TypeScript compiles cleanly**

  ```bash
  npx tsc --noEmit 2>&1 | head -20
  ```

  Expected: no errors (the server's `Planet` interface now matches `PlanetSummary`, and the socket layer passes them through without mapping).

- [ ] **Commit**

  ```bash
  git add src/core/types.ts
  git commit -m "feat(types): add hasClouds to PlanetSummary"
  ```

---

## Task 4: Cloud shader — `CloudMaterial.tsx`

**Files:**
- Create: `src/client/scene/CloudMaterial.tsx`

- [ ] **Create the file**

  ```tsx
  import { shaderMaterial } from '@react-three/drei'
  import { extend } from '@react-three/fiber'
  import { Color, Vector3 } from 'three'

  const VERT = /* glsl */`
  varying vec3 vPos;

  void main() {
    vPos        = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
  `

  const FRAG = /* glsl */`
  uniform vec3  u_seed;
  uniform float u_coverage;
  uniform float u_opacity;
  uniform vec3  u_color;
  uniform float u_time;

  varying vec3 vPos;

  float hash(vec3 p) {
    p  = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i),               hash(i + vec3(1,0,0)), u.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y),
      u.z
    );
  }

  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) {
      v += a * noise(p);
      p  = p * 2.0 + vec3(5.7, 3.2, 1.4);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Fast layer: detailed cloud shapes + slow morphing drift
    float fast    = fbm(vPos * 2.5 + u_seed + vec3(u_time * 0.025, 0.0, u_time * 0.01));
    // Slow layer: large-scale formation / dissipation envelope
    float slow    = fbm(vPos * 1.2 + u_seed * 0.7 + vec3(0.0, u_time * 0.006, 0.0));
    // Combine: fast detail weighted by slow envelope
    float density = fast * (0.5 + 0.7 * slow);
    // Soft threshold: wispy edges, denser centres
    float alpha   = smoothstep(u_coverage - 0.15, u_coverage + 0.05, density) * u_opacity;
    gl_FragColor  = vec4(u_color, clamp(alpha, 0.0, 1.0));
  }
  `

  export const CloudMaterial = shaderMaterial(
    {
      u_time:     0,
      u_seed:     new Vector3(0, 0, 0),
      u_coverage: 0.45,
      u_opacity:  0.85,
      u_color:    new Color(0.95, 0.95, 1.0),
    },
    VERT,
    FRAG,
  )

  extend({ CloudMaterial })
  ```

- [ ] **Add JSX type declaration**

  At the bottom of `src/client/scene/CloudMaterial.tsx`, after the `extend` call, add the module augmentation so TypeScript recognises `<cloudMaterial>` as a valid JSX element (same pattern as `PlanetMaterial.tsx` would use if it had one — check if there's a global declaration file first):

  ```bash
  grep -rn "planetAtmoMaterial\|ShaderMaterialProps\|ThreeElements" src/client/ --include="*.d.ts" --include="*.tsx" | grep -v "node_modules" | head -10
  ```

  If there's a global `@react-three/fiber` augmentation file (e.g. `src/client/r3f.d.ts`), add `cloudMaterial` there. If not, append to `CloudMaterial.tsx`:

  ```ts
  import type { ShaderMaterialProps } from '@react-three/fiber'

  declare module '@react-three/fiber' {
    interface ThreeElements {
      cloudMaterial: ShaderMaterialProps & {
        u_time?: number
        u_seed?: import('three').Vector3
        u_coverage?: number
        u_opacity?: number
        u_color?: import('three').Color
      }
    }
  }
  ```

- [ ] **Commit**

  ```bash
  git add src/client/scene/CloudMaterial.tsx
  git commit -m "feat(scene): CloudMaterial — FBM procedural cloud shader"
  ```

---

## Task 5: Planet integration — cloud sphere + animation

**Files:**
- Modify: `src/client/scene/Planet.tsx`

- [ ] **Add imports**

  At the top of `src/client/scene/Planet.tsx`, add:

  ```ts
  import './CloudMaterial'
  import { hashStringToInt, hashByte, deriveHash } from './lib/hash'
  ```

- [ ] **Add refs inside `PlanetInner`**

  After the existing `atmoMatRef` ref declaration (line 54), add:

  ```ts
  const cloudSpinRef = useRef<Group>(null)
  const cloudMatRef  = useRef<ShaderMaterial>(null)
  ```

- [ ] **Derive cloud seed and coverage**

  After the `atmoColor` memo (around line 73), add:

  ```ts
  const cloudSeed = useMemo(() => {
    const h = hashStringToInt(planet.name)
    return new Vector3(
      hashByte(h, 0) / 32,
      hashByte(h, 1) / 32,
      hashByte(h, 2) / 32,
    )
  }, [planet.name])

  const cloudCoverage = useMemo(() => {
    const h = deriveHash(hashStringToInt(planet.name), 'clouds')
    return 0.3 + (hashByte(h, 0) / 255) * 0.4
  }, [planet.name])
  ```

- [ ] **Extend `useFrame` with cloud updates**

  Inside the `useFrame` callback, after the existing atmosphere brightness line (`if (atmoMatRef.current) ...`), add:

  ```ts
  if (cloudSpinRef.current) {
    cloudSpinRef.current.rotation.y += dt * params.rotationSpeed * 0.02 * 1.15
  }
  if (cloudMatRef.current) {
    ;(cloudMatRef.current as any).u_time    += dt
    ;(cloudMatRef.current as any).u_opacity  = 0.85 * brightness.current
  }
  ```

- [ ] **Add the cloud sphere to JSX**

  Place the cloud sphere AFTER the closing `</group>` of `spinRef` (line 192) and BEFORE the atmosphere `<mesh>` (line 196). This keeps it outside `spinRef` so planet-surface rotation doesn't double-apply, while `cloudSpinRef` drives its own independent rotation.

  ```jsx
        </group>

        {planet.hasClouds && (
          <group ref={cloudSpinRef}>
            <mesh>
              <sphereGeometry args={[params.radius * 1.02, 64, 64]} />
              {/* @ts-ignore */}
              <cloudMaterial
                ref={cloudMatRef}
                u_seed={cloudSeed}
                u_coverage={cloudCoverage}
                transparent
                depthTest
                depthWrite={false}
              />
            </mesh>
          </group>
        )}

        {/* Atmosphere — FrontSide rim-halo glow. */}
        <mesh>
  ```

- [ ] **Verify TypeScript compiles**

  ```bash
  npx tsc --noEmit 2>&1 | head -20
  ```

  Expected: no new errors.

- [ ] **Run client tests to confirm nothing broken**

  ```bash
  npm run test:client 2>&1 | tail -10
  ```

  Expected: all existing tests pass.

- [ ] **Commit**

  ```bash
  git add src/client/scene/Planet.tsx
  git commit -m "feat(planet): procedural cloud layer — FBM sphere with independent rotation"
  ```

---

## Task 6: Visual verification & push

- [ ] **Start dev server**

  ```bash
  npm run dev
  ```

  Open `http://localhost:5173` in a browser.

- [ ] **Verify in system view**

  Some planets should have a visible white cloud layer rotating slightly faster than the surface. Planets without clouds should look unchanged.

- [ ] **Verify in planetary close-up**

  Click a planet that has clouds. The cloud pattern should be visible as wispy white shapes. Over ~30 seconds of watching, the pattern should slowly morph and areas of coverage should shift.

- [ ] **Verify gas planets**

  Click through several gas-type planets — none should have a cloud layer.

- [ ] **Push**

  ```bash
  git push
  ```
