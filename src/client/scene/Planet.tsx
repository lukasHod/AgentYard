import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Group } from 'three'
import { derivePlanetParams } from './lib/planetParams'
import { PlanetMaterial } from './PlanetMaterial'
import type { PlanetSummary } from '../../core/types'
import { useUiStore } from '../state/uiStore'
import { useFeaturesMap } from '../state/socketStore'
import { Ship } from './Ship'
import { ringAngles } from './lib/orbits'

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

  const features = useFeaturesMap().get(planet.id) ?? []
  const active = useMemo(() => features.filter((f) => f.status === 'running'), [features])
  const angles = useMemo(() => ringAngles(active.length), [active.length])
  const shipOrbitRadius = params.radius * 1.8

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
        {active.map((f, i) => (
          <Ship key={f.id} feature={f} orbitRadius={shipOrbitRadius} orbitAngle={angles[i]!} />
        ))}
      </group>
    </group>
  )
}
