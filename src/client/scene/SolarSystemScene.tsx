// src/client/scene/SolarSystemScene.tsx
import { useMemo, useCallback } from 'react'
import { Stars } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { Sun } from './Sun'
import { Planet } from './Planet'
import { CameraRig } from './CameraRig'
import { planetOrbitPositions, ringAngles } from './lib/orbits'
import { derivePlanetParams } from './lib/planetParams'
import { usePlanets, useFeaturesMap } from '../state/socketStore'

export function SolarSystemScene() {
  const planets = usePlanets()
  const positions = planetOrbitPositions(planets.length)

  const planetWorld = useMemo(() => {
    const map = new Map<number, { x: number; y: number; z: number }>()
    planets.forEach((p, i) => {
      const angle = (i * Math.PI) / 3 // matches orbitAngleOffset in <Planet>
      const radius = positions[i]!.radius
      map.set(p.id, { x: Math.cos(angle) * radius, y: 0, z: -Math.sin(angle) * radius })
    })
    return map
  }, [planets, positions])

  const lookup = useCallback((id: number) => planetWorld.get(id) ?? null, [planetWorld])

  const features = useFeaturesMap()

  const shipPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; z: number }>()
    planets.forEach((p, pi) => {
      const planetAngle = (pi * Math.PI) / 3
      const planetX = Math.cos(planetAngle) * positions[pi]!.radius
      const planetZ = -Math.sin(planetAngle) * positions[pi]!.radius
      const fs = (features.get(p.id) ?? []).filter((f) => f.status === 'running')
      const angles = ringAngles(fs.length)
      const planetParams = derivePlanetParams(p.name)
      const ringR = planetParams.radius * 1.8
      fs.forEach((f, i) => {
        map.set(`${p.id}:${f.id}`, {
          x: planetX + Math.cos(angles[i]!) * ringR,
          y: 0,
          z: planetZ + Math.sin(angles[i]!) * ringR,
        })
      })
    })
    return map
  }, [planets, features, positions])

  const shipLookup = useCallback(
    (planetId: number, featureId: number) => shipPositions.get(`${planetId}:${featureId}`) ?? null,
    [shipPositions],
  )

  return (
    <>
      <color attach="background" args={['#020617']} />
      <Stars radius={300} depth={60} count={6000} factor={4} saturation={0} fade speed={0.3} />
      <ambientLight intensity={0.15} />
      <Sun />
      {planets.map((p, i) => (
        <Planet key={p.id} planet={p} orbitRadius={positions[i]!.radius} orbitAngleOffset={(i * Math.PI) / 3} />
      ))}
      <CameraRig planetLookup={lookup} shipLookup={shipLookup} />
      <EffectComposer>
        <Bloom intensity={1.0} luminanceThreshold={0.25} luminanceSmoothing={0.4} mipmapBlur />
        <Vignette darkness={0.6} offset={0.3} />
      </EffectComposer>
    </>
  )
}
