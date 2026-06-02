import { useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Color, Group, MeshStandardMaterial, Vector3 } from 'three'
import { derivePlanetParams } from './lib/planetParams'
import type { FeatureSummary, PlanetSummary } from '../../core/types'
import { useUiStore } from '../state/uiStore'
import { useFeaturesMap, useSessionList, usePendingsMap } from '../state/socketStore'
import { Ship } from './Ship'
import { ringAngles } from './lib/orbits'
import { registerPlanetPosition } from './lib/positionRegistry'

const BACKGROUND_SCALE = 0.1     // size of non-focused planets when something else is focused
const BACKGROUND_BRIGHTNESS = 0.4 // colour multiplier for non-focused planets
const RESPONSE = 4               // ~250ms smooth-step toward target

interface PlanetProps {
  planet: PlanetSummary
  orbitRadius: number
  orbitAngleOffset: number
}

export function Planet({ planet, orbitRadius, orbitAngleOffset }: PlanetProps) {
  const params = useMemo(() => derivePlanetParams(planet.name), [planet.name])
  const groupRef = useRef<Group>(null)
  const meshRef = useRef<Group>(null)
  const materialRef = useRef<MeshStandardMaterial>(null)
  const focusPlanet = useUiStore((s) => s.focusPlanet)

  // Focus-derived "is this planet the centre of attention or a background
  // element?" — drives the scale + brightness tween below.
  const isThisFocused = useUiStore(
    (s) =>
      (s.focus.lod === 1 && 'planetId' in s.focus && s.focus.planetId === planet.id) ||
      (s.focus.lod === 2 && s.focus.planetId === planet.id),
  )
  const isAnyFocused = useUiStore((s) => s.focus.lod >= 1)
  const shouldDim = isAnyFocused && !isThisFocused

  const baseColor = useMemo(
    () => new Color().setHSL(params.paletteHue / 360, 0.55, 0.45),
    [params.paletteHue],
  )
  const brightness = useRef(1)
  const scale = useRef(1)

  const features = useFeaturesMap().get(planet.id) ?? []

  // Track features that are currently playing their despawn animation.
  // These are kept mounted after they leave the 'running' state so the
  // flash-and-fade has time to complete before we unmount the Ship.
  const [despawning, setDespawning] = useState<FeatureSummary[]>([])

  // Remember which feature ids were running on the previous render so we can
  // detect the transition running → complete/failed.
  const prevRunningIds = useRef<Set<number>>(new Set())

  useEffect(() => {
    const currentRunningIds = new Set(
      features.filter((f) => f.status === 'running').map((f) => f.id),
    )

    // Find features that just transitioned out of running into complete/failed
    // and are not yet in the despawning list.
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

    if (justEnded.length > 0) {
      setDespawning((prev) => [...prev, ...justEnded])
    }

    prevRunningIds.current = currentRunningIds
  }, [features, despawning])

  // Called by Ship when its despawn animation completes.
  const onShipDespawned = useCallback((featureId: number) => {
    setDespawning((prev) => prev.filter((f) => f.id !== featureId))
  }, [])

  // The full set of ships to render = currently running + those finishing despawn.
  const visible = useMemo(
    () => [
      ...features.filter((f) => f.status === 'running'),
      ...despawning,
    ],
    [features, despawning],
  )

  const angles = useMemo(() => ringAngles(visible.length), [visible.length])
  const shipOrbitRadius = params.radius * 1.8

  const sessions = useSessionList()
  const pendings = usePendingsMap()

  // The server enforces single-active-feature per planet today, so all the
  // agents currently in `sessions` belong to the running feature on this
  // planet (if any). When that invariant changes, we'll need to label-route.
  const droneSessions = useMemo(
    () => sessions.filter((s) => s.role === 'drone' || s.role === 'leader'),
    [sessions],
  )
  const pendingDroneIds = useMemo(
    () => new Set(droneSessions.filter((s) => pendings.has(s.id)).map((s) => s.id)),
    [droneSessions, pendings],
  )

  useFrame((_, dt) => {
    if (groupRef.current) {
      // Orbit around the sun
      groupRef.current.rotation.y += dt * 0.05 // shared orbit speed for now
    }
    if (meshRef.current) {
      meshRef.current.rotation.y += dt * (params.rotationSpeed * 0.4)
    }

    // Smooth-step toward target brightness + scale based on focus state.
    const targetBrightness = shouldDim ? BACKGROUND_BRIGHTNESS : 1
    brightness.current += (targetBrightness - brightness.current) * Math.min(1, dt * RESPONSE)
    if (materialRef.current) {
      materialRef.current.color.copy(baseColor).multiplyScalar(brightness.current)
    }

    const targetScale = shouldDim ? BACKGROUND_SCALE : 1
    scale.current += (targetScale - scale.current) * Math.min(1, dt * RESPONSE)
    if (meshRef.current) {
      meshRef.current.scale.setScalar(scale.current)
    }
  })

  // Expose the planet's live world position so the camera rig can track it
  // as it orbits. The getter is stable; it reads the ref each call so the
  // returned vector always reflects the current frame's transform.
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
        <mesh>
          <sphereGeometry args={[params.radius, 48, 48]} />
          <meshStandardMaterial ref={materialRef} color={baseColor} roughness={0.6} metalness={0.05} />
        </mesh>
        {params.hasRing && (
          <mesh rotation={[Math.PI / 2.3, 0, 0]}>
            <ringGeometry args={[params.radius * 1.4, params.radius * 1.9, 64]} />
            <meshBasicMaterial color="#94a3b8" transparent opacity={0.4} side={2 /* DoubleSide */} />
          </mesh>
        )}
        {!planet.pathExists && (
          <mesh>
            <sphereGeometry args={[params.radius * 1.01, 32, 32]} />
            <meshBasicMaterial color="#f43f5e" transparent opacity={0.25} wireframe />
          </mesh>
        )}
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
