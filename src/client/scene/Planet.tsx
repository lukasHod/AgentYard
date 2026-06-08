import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { AdditiveBlending, Color, Group, MeshBasicMaterial, ShaderMaterial, Vector3 } from 'three'
import { derivePlanetParams } from './lib/planetParams'
import { getPlanetTexturePath } from './lib/planetTextures'
import { atmosphereColorFromImage } from './lib/textureColor'
import './PlanetMaterial'
import './CloudMaterial'
import { hashStringToInt, hashByte, deriveHash } from './lib/hash'
import type { FeatureSummary, PlanetSummary } from '../../core/types'
import { useUiStore } from '../state/uiStore'
import { useFeaturesMap, useSessionList, usePendingsMap } from '../state/socketStore'
import { Ship } from './Ship'
import { ringAngles } from './lib/orbits'
import { registerPlanetPosition } from './lib/positionRegistry'

// Atmosphere shell radius as a multiple of the planet radius. The glow peaks
// at the planet's rim and fades out well inside this silhouette, so the shell
// only needs to be large enough to give that outward fade room to land softly.
const ATMO_SCALE = 1.25
// Fresnel value (e = 1 - facing) at which the planet's limb projects onto the
// atmosphere shell. Drives where the glow peaks so it sits exactly on the rim.
const ATMO_RIM_E = 1 - Math.sqrt(1 - 1 / (ATMO_SCALE * ATMO_SCALE))
// Fresnel value where the glow has fully faded — kept clear of the silhouette
// (e → 1) so the soft outer edge doesn't fall in the gradient-blowup zone.
const ATMO_OUTER_E = 0.46

const BACKGROUND_SCALE = 0.1
const BACKGROUND_BRIGHTNESS = 0.4
const RESPONSE = 4
const DOLLY_DURATION = 0.8
const SCALE_DELAY = DOLLY_DURATION * 0.8

interface PlanetProps {
  planet: PlanetSummary
  orbitRadius: number
  orbitAngleOffset: number
}

function PlanetInner({ planet, orbitRadius, orbitAngleOffset }: PlanetProps) {
  const params  = useMemo(() => derivePlanetParams(planet.name), [planet.name])
  const texPath = useMemo(() => getPlanetTexturePath(planet.name, params.surfaceType), [planet.name, params.surfaceType])
  const texture = useTexture(texPath)

  const groupRef    = useRef<Group>(null)
  // meshRef: position + scale anchor. Ships dock via shipHostRef (see below).
  // spinRef: self-rotation only — keeps ships from orbiting the planet axis.
  const meshRef     = useRef<Group>(null)
  const spinRef     = useRef<Group>(null)
  // Counter-rotates exactly -groupRef.rotation.y each frame so that ships
  // inside it stay at a FIXED world-space angle relative to the planet,
  // independent of the planet's orbital phase around the sun.
  const shipHostRef = useRef<Group>(null)
  const surfMatRef = useRef<MeshBasicMaterial>(null)
  const atmoMatRef = useRef<ShaderMaterial>(null)
  const cloudSpinRef = useRef<Group>(null)
  const cloudMatRef  = useRef<ShaderMaterial>(null)
  const focusPlanet = useUiStore((s) => s.focusPlanet)

  const isThisFocused = useUiStore(
    (s) =>
      (s.focus.lod === 1 && 'planetId' in s.focus && s.focus.planetId === planet.id) ||
      (s.focus.lod === 2 && s.focus.planetId === planet.id),
  )
  const isAnyFocused = useUiStore((s) => s.focus.lod >= 1)
  const shouldDim    = isAnyFocused && !isThisFocused

  // Atmosphere tint derived from the planet's actual surface texture, so the
  // glow always matches the planet (icy → light grey, lava → red, etc.) and
  // can never drift to an unrelated hue.
  const atmoColor = useMemo(() => {
    const img = texture.image as CanvasImageSource | undefined
    return img
      ? atmosphereColorFromImage(texPath, img)
      : new Color(0.7, 0.75, 0.8)
  }, [texPath, texture])

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

  const brightness       = useRef(1)
  const scale            = useRef(1)
  const speedFactor      = useRef(1)
  const sinceFocusChange = useRef(0)
  useEffect(() => { sinceFocusChange.current = 0 }, [shouldDim, isAnyFocused])

  const features = useFeaturesMap().get(planet.id) ?? []
  const [despawning, setDespawning] = useState<FeatureSummary[]>([])
  const prevRunningIds = useRef<Set<number>>(new Set())

  useEffect(() => {
    const currentRunningIds = new Set(
      features.filter((f) => f.status === 'running').map((f) => f.id),
    )
    const justEnded: FeatureSummary[] = []
    for (const f of features) {
      if (
        (f.status === 'complete' || f.status === 'failed') &&
        prevRunningIds.current.has(f.id) &&
        !despawning.some((d) => d.id === f.id)
      ) {
        justEnded.push(f)
      }
    }
    if (justEnded.length > 0) setDespawning((prev) => [...prev, ...justEnded])
    prevRunningIds.current = currentRunningIds
  }, [features, despawning])

  const onShipDespawned = useCallback((featureId: number) => {
    setDespawning((prev) => prev.filter((f) => f.id !== featureId))
  }, [])

  const visible = useMemo(
    () => [...features.filter((f) => f.status === 'running'), ...despawning],
    [features, despawning],
  )
  // 135° (3π/4) offset: puts the first ship in front of the planet's lit limb as
  // seen from the close-up camera (offset +z=1.3 from planet, looking toward −x).
  // At 135° the ship sits at (+z, −x) relative to the planet — the camera-to-ship
  // ray misses the planet sphere for all planet radii (clearance verified ≥ 1.25×
  // planet radius). Orbit radius 1.5× gives further clearance above the surface.
  const angles          = useMemo(() => ringAngles(visible.length).map(a => a + (3 * Math.PI) / 4), [visible.length])
  const shipOrbitRadius = params.radius * 1.5

  const sessions      = useSessionList()
  const pendings      = usePendingsMap()
  const droneSessions = useMemo(
    () => sessions.filter((s) => s.role === 'drone' || s.role === 'leader'),
    [sessions],
  )
  const pendingDroneIds = useMemo(
    () => new Set(droneSessions.filter((s) => pendings.has(s.id)).map((s) => s.id)),
    [droneSessions, pendings],
  )

  useFrame((_, dt) => {
    const sf = speedFactor.current
    if (groupRef.current) groupRef.current.rotation.y += dt * 0.05 * sf
    if (spinRef.current)  spinRef.current.rotation.y  += dt * (params.rotationSpeed * 0.02)
    // Cancel the orbit rotation for ships so they remain at a fixed world-space
    // angle relative to the planet regardless of how far the planet has orbited.
    if (shipHostRef.current && groupRef.current) {
      shipHostRef.current.rotation.y = -groupRef.current.rotation.y
    }

    const targetBrightness = shouldDim ? BACKGROUND_BRIGHTNESS : 1
    brightness.current += (targetBrightness - brightness.current) * Math.min(1, dt * RESPONSE)
    const b = brightness.current
    if (surfMatRef.current) surfMatRef.current.color.setScalar(b)
    if (atmoMatRef.current) (atmoMatRef.current as any).u_brightness = b
    if (cloudSpinRef.current) {
      cloudSpinRef.current.rotation.y += dt * params.rotationSpeed * 0.02 * 1.15
    }
    if (cloudMatRef.current) {
      ;(cloudMatRef.current as any).u_time   += dt
      ;(cloudMatRef.current as any).u_opacity = 0.85 * brightness.current
    }

    sinceFocusChange.current += dt
    const isRestoring = !isAnyFocused
    if (isRestoring || sinceFocusChange.current >= SCALE_DELAY) {
      const targetScale = shouldDim ? BACKGROUND_SCALE : 1
      scale.current += (targetScale - scale.current) * Math.min(1, dt * RESPONSE)
      if (meshRef.current) meshRef.current.scale.setScalar(scale.current)

      // Stop orbital motion when this planet is focused so ships stay
      // at a fixed position relative to the camera for the entire session.
      const targetSpeed = isAnyFocused ? 0.0 : 1
      speedFactor.current += (targetSpeed - speedFactor.current) * Math.min(1, dt * RESPONSE)
    }
  })

  useEffect(() => {
    const out = new Vector3()
    return registerPlanetPosition(planet.id, () => {
      if (!meshRef.current) return null
      meshRef.current.getWorldPosition(out)
      return out
    })
  }, [planet.id])

  return (
    <group ref={groupRef} rotation={[0, orbitAngleOffset, 0]}>
      <group ref={meshRef} position={[orbitRadius, 0, 0]} onClick={(e) => { e.stopPropagation(); focusPlanet(planet.id) }}>
        <group ref={spinRef}>
          {/* Texture surface — no lighting */}
          <mesh>
            <sphereGeometry args={[params.radius, 64, 64]} />
            <meshBasicMaterial ref={surfMatRef} map={texture} />
          </mesh>

          {params.hasRing && (
            <mesh rotation={[Math.PI / 2.3, 0, 0]}>
              <ringGeometry args={[params.radius * 1.4, params.radius * 1.9, 64]} />
              <meshBasicMaterial color="#94a3b8" transparent opacity={0.4} side={2} />
            </mesh>
          )}

          {!planet.pathExists && (
            <mesh>
              <sphereGeometry args={[params.radius * 1.01, 32, 32]} />
              <meshBasicMaterial color="#f43f5e" transparent opacity={0.25} wireframe />
            </mesh>
          )}
        </group>

        {planet.hasClouds && (
          <group ref={cloudSpinRef}>
            <mesh>
              <sphereGeometry args={[params.radius * 1.02, 64, 64]} />
              <planetCloudMaterial
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

        {/* Atmosphere — FrontSide rim-halo glow. depthTest disabled + zero
            intensity at the mesh silhouette = no limb flicker (see PlanetMaterial). */}
        <mesh>
          <sphereGeometry args={[params.radius * ATMO_SCALE, 64, 64]} />
          {/* @ts-ignore */}
          <planetAtmoMaterial
            ref={atmoMatRef}
            u_color={atmoColor}
            u_brightness={1}
            u_rimE={ATMO_RIM_E}
            u_outerE={ATMO_OUTER_E}
            transparent
            depthTest={false}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>

        <group ref={shipHostRef}>
          {visible.map((f, i) => (
            <Ship
              key={f.id}
              feature={f}
              orbitRadius={shipOrbitRadius}
              orbitAngle={angles[i]!}
              drones={droneSessions}
              pendingDroneIds={pendingDroneIds}
              onDespawned={() => onShipDespawned(f.id)}
            />
          ))}
        </group>
      </group>
    </group>
  )
}

function FallbackPlanet({ planet, orbitRadius, orbitAngleOffset }: PlanetProps) {
  const params    = useMemo(() => derivePlanetParams(planet.name), [planet.name])
  const baseColor = useMemo(
    () => new Color().setHSL(params.paletteHue / 360, 0.55, 0.45),
    [params.paletteHue],
  )
  return (
    <group rotation={[0, orbitAngleOffset, 0]}>
      <group position={[orbitRadius, 0, 0]}>
        <mesh>
          <sphereGeometry args={[params.radius, 32, 32]} />
          <meshBasicMaterial color={baseColor} />
        </mesh>
      </group>
    </group>
  )
}

export function Planet(props: PlanetProps) {
  return (
    <Suspense fallback={<FallbackPlanet {...props} />}>
      <PlanetInner {...props} />
    </Suspense>
  )
}
