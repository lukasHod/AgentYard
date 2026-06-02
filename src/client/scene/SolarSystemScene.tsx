// src/client/scene/SolarSystemScene.tsx
import { useCallback } from 'react'
import { Stars } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { Sun } from './Sun'
import { Planet } from './Planet'
import { CameraRig } from './CameraRig'
import { planetOrbitPositions } from './lib/orbits'
import { usePlanets } from '../state/socketStore'
import { getPlanetPosition, getShipPosition } from './lib/positionRegistry'

export function SolarSystemScene() {
  const planets = usePlanets()
  const positions = planetOrbitPositions(planets.length)

  // Camera lookups read live world positions from the registry that Planet /
  // Ship components write into each frame. This is what lets the camera
  // track an orbiting planet so it appears stationary from the user's POV.
  const planetLookup = useCallback((id: number) => {
    const v = getPlanetPosition(id)
    return v ? { x: v.x, y: v.y, z: v.z } : null
  }, [])

  const shipLookup = useCallback((planetId: number, featureId: number) => {
    const v = getShipPosition(planetId, featureId)
    return v ? { x: v.x, y: v.y, z: v.z } : null
  }, [])

  return (
    <>
      <color attach="background" args={['#020617']} />
      <Stars radius={300} depth={60} count={6000} factor={4} saturation={0} fade speed={0.3} />
      <ambientLight intensity={0.15} />
      <Sun />
      {planets.map((p, i) => (
        <Planet key={p.id} planet={p} orbitRadius={positions[i]!.radius} orbitAngleOffset={(i * Math.PI) / 3} />
      ))}
      <CameraRig planetLookup={planetLookup} shipLookup={shipLookup} />
      <EffectComposer>
        <Bloom intensity={1.0} luminanceThreshold={0.25} luminanceSmoothing={0.4} mipmapBlur />
        <Vignette darkness={0.6} offset={0.3} />
      </EffectComposer>
    </>
  )
}
