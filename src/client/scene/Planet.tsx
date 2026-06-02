import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { Color, Group, MeshBasicMaterial, ShaderMaterial, Vector3 } from 'three'
import { derivePlanetParams } from './lib/planetParams'
import { getPlanetTexturePath } from './lib/planetTextures'
import type { SurfaceType } from './lib/planetParams'
import './PlanetMaterial'
import type { FeatureSummary, PlanetSummary } from '../../core/types'
import { useUiStore } from '../state/uiStore'
import { useFeaturesMap, useSessionList, usePendingsMap } from '../state/socketStore'
import { Ship } from './Ship'
import { ringAngles } from './lib/orbits'
import { registerPlanetPosition } from './lib/positionRegistry'

// Natural atmosphere colours per surface type — matches the texture palette
const ATMO_COLOR: Record<SurfaceType, string> = {
  rocky:   '#b89060',  // dusty tan (Alpine / Martian / Savannah)
  gas:     '#c87840',  // warm amber (Gaseous)
  lava:    '#e04818',  // orange-red (Volcanic)
  ice:     '#90c8f0',  // pale ice blue (Icy)
  ocean:   '#3060d8',  // deep blue (Terrestrial / Tropical / Swamp)
  crystal: '#c8b850',  // pale gold (Venusian)
  ringed:  '#b07038',  // warm bronze (mixed)
}

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

  const groupRef   = useRef<Group>(null)
  // meshRef: position + scale anchor (ships dock here, no rotation)
  // spinRef: self-rotation only — keeps ships from orbiting the planet axis
  const meshRef    = useRef<Group>(null)
  const spinRef    = useRef<Group>(null)
  const surfMatRef = useRef<MeshBasicMaterial>(null)
  const atmoMatRef = useRef<ShaderMaterial>(null)
  const focusPlanet = useUiStore((s) => s.focusPlanet)

  const isThisFocused = useUiStore(
    (s) =>
      (s.focus.lod === 1 && 'planetId' in s.focus && s.focus.planetId === planet.id) ||
      (s.focus.lod === 2 && s.focus.planetId === planet.id),
  )
  const isAnyFocused = useUiStore((s) => s.focus.lod >= 1)
  const shouldDim    = isAnyFocused && !isThisFocused

  const atmoColor = useMemo(
    () => new Color(ATMO_COLOR[params.surfaceType]),
    [params.surfaceType],
  )

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
  const angles          = useMemo(() => ringAngles(visible.length), [visible.length])
  const shipOrbitRadius = params.radius * 1.8

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
    if (spinRef.current)  spinRef.current.rotation.y  += dt * (params.rotationSpeed * 0.4) * sf

    const targetBrightness = shouldDim ? BACKGROUND_BRIGHTNESS : 1
    brightness.current += (targetBrightness - brightness.current) * Math.min(1, dt * RESPONSE)
    const b = brightness.current
    if (surfMatRef.current) surfMatRef.current.color.setScalar(b)
    if (atmoMatRef.current) (atmoMatRef.current as any).u_brightness = b

    sinceFocusChange.current += dt
    const isRestoring = !isAnyFocused
    if (isRestoring || sinceFocusChange.current >= SCALE_DELAY) {
      const targetScale = shouldDim ? BACKGROUND_SCALE : 1
      scale.current += (targetScale - scale.current) * Math.min(1, dt * RESPONSE)
      if (meshRef.current) meshRef.current.scale.setScalar(scale.current)

      const targetSpeed = isAnyFocused ? 0.1 : 1
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

        {/* Atmosphere — BackSide scatter glow, outside spinRef (spherically symmetric) */}
        <mesh>
          <sphereGeometry args={[params.radius * 1.03, 48, 48]} />
          {/* @ts-ignore */}
          <planetAtmoMaterial
            ref={atmoMatRef}
            u_color={atmoColor}
            u_brightness={1}
            transparent
            depthWrite={false}
            side={1}
          />
        </mesh>

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
