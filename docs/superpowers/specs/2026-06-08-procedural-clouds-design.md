# Procedural Planet Clouds — Design Spec

Date: 2026-06-08

## Overview

Add a procedural cloud layer to planets. Clouds are:
- Deterministic: baked at planet creation time and stored in the DB (same pattern as `texture`)
- Probabilistic: weighted by surface type so only some planets have clouds
- Animated: slow independent rotation + FBM morphing + formation/dissipation
- Fully GPU-side: no texture files, GLSL FBM noise shader

---

## 1. Database & Backend

### Migration (`src/server/db.ts`)
Add `has_clouds INTEGER NOT NULL DEFAULT 0` to the `planets` table.
Follows the same migration guard pattern as the existing `texture` column:
```js
if (tableExists(db, 'planets') && !columnExists(db, 'planets', 'has_clouds')) {
  db.exec(`ALTER TABLE planets ADD COLUMN has_clouds INTEGER NOT NULL DEFAULT 0`)
}
```
Existing planets default to `0` — they were "created without clouds" and stay that way forever.

### `pickHasClouds(name)` (`src/server/planets.ts`)
Inlines the minimal FNV-1a hash logic (same algorithm as `src/client/scene/lib/hash.ts`) to derive the surface type server-side, then rolls against a per-type probability:

| Surface type | Cloud probability |
|---|---|
| ocean   | 75% |
| ice     | 60% |
| rocky   | 45% |
| ringed  | 25% |
| crystal | 20% |
| lava    | 10% |
| gas     | 0%  |

Uses a second derived hash for the probability roll (independent of the surface-type hash byte) so the two values don't correlate.

### `createPlanet` update
Computes `hasClouds = pickHasClouds(name)` and adds it to the `INSERT` statement alongside `texture`.

### Types
- `Planet` and `PlanetRow` in `planets.ts` gain `hasClouds: boolean`
- `PlanetSummary` in `src/core/types.ts` gains `hasClouds: boolean`
- Server route that builds `PlanetSummary` maps `has_clouds` → `hasClouds`

---

## 2. Cloud Shader (`src/client/scene/CloudMaterial.tsx`)

New file, same `shaderMaterial` + `extend` pattern as `PlanetMaterial.tsx`. Registers `<cloudMaterial>` JSX primitive.

### Uniforms

| Uniform | Type | Purpose |
|---|---|---|
| `u_time` | float | Drives morphing and formation/dissipation |
| `u_seed` | vec3 | Per-planet 3D noise offset (from name hash) |
| `u_coverage` | float | Base cloud coverage 0.3–0.7 (from name hash) |
| `u_opacity` | float | Overall transparency (default 0.85) |
| `u_color` | vec3 | Cloud tint (default near-white `(0.95, 0.95, 1.0)`) |

### Vertex shader
Passes `vNormalView`, `vViewDir`, and `vPos` (local sphere position, used as 3D noise coordinates).

### Fragment shader — FBM cloud pattern
```
1. Use vPos (normalized sphere surface point) as the base 3D coordinate.
2. Add u_seed to offset the pattern per-planet.
3. FBM with 6 octaves, lacunarity 2.0, gain 0.5, base frequency 2.5.
4. A second slower FBM (u_time * 0.006) produces a low-frequency "coverage mask"
   that drives formation/dissipation — some regions slowly grow/shrink clouds.
5. Threshold: cloud_value = fbm(pos + u_time * 0.025) * coverage_mask
6. alpha = smoothstep(u_coverage - 0.15, u_coverage + 0.05, cloud_value) * u_opacity
   — soft edges give the wispy appearance.
7. Fresnel fade: reduce alpha near the disc centre (facing camera) to keep clouds
   translucent from head-on, denser at the limb — makes them look volumetric.
```

### Material properties
- `transparent: true`
- `depthTest: true`, `depthWrite: false`
- Normal (alpha) blending — NOT additive, so white clouds show against the dark planet texture

---

## 3. Integration into `Planet.tsx`

### New refs
- `cloudSpinRef: useRef<Group>(null)` — the cloud sphere's rotation group

### Seed derivation (client-side, for shader only)
Three independent hash bytes from the planet name → `u_seed` as `Vector3(x, y, z)` scaled to `0..8` range. Also one hash byte → `u_coverage` in `0.3..0.7`.

### JSX structure
```jsx
{planet.hasClouds && (
  <group ref={cloudSpinRef}>
    <mesh>
      <sphereGeometry args={[params.radius * 1.02, 64, 64]} />
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
```

### `useFrame` additions
```js
// Cloud rotation — slightly faster than planet surface
if (cloudSpinRef.current) {
  cloudSpinRef.current.rotation.y += dt * params.rotationSpeed * 0.02 * 1.15
}
// Time uniform for morphing
if (cloudMatRef.current) {
  cloudMatRef.current.u_time += dt
}
// Dim clouds along with the planet when focused elsewhere
if (cloudMatRef.current) {
  cloudMatRef.current.u_opacity = 0.85 * brightness.current
}
```

---

## 4. Performance

- Shader runs on all cloud planets every frame — no LOD switching needed
- FBM at 6 octaves per fragment is the main cost; acceptable for ~5–10 planets
- If perf becomes an issue: reduce octave count (4 is the minimum for wispy look) or lower sphere resolution from 64×64 to 32×32 for background planets (shouldDim)
- No CPU work: all noise is GPU-side

---

## 5. File Change Summary

| File | Change |
|---|---|
| `src/server/db.ts` | Migration: add `has_clouds` column |
| `src/server/planets.ts` | `pickHasClouds()`, update `Planet`/`PlanetRow`, `createPlanet` INSERT |
| `src/core/types.ts` | `PlanetSummary.hasClouds: boolean` |
| `src/server/routes/planets.ts` | Map `has_clouds` → `hasClouds` in summary |
| `src/client/scene/CloudMaterial.tsx` | New file — shader + material registration |
| `src/client/scene/Planet.tsx` | Cloud sphere, refs, useFrame additions |
