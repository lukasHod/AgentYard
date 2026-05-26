// src/client/scene/SolarSystemScene.tsx
import { Stars } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { Sun } from './Sun'
import { Planet } from './Planet'
import { planetOrbitPositions } from './lib/orbits'
import { usePlanets } from '../state/socketStore'

export function SolarSystemScene() {
  const planets = usePlanets()
  const positions = planetOrbitPositions(planets.length)

  return (
    <>
      <color attach="background" args={['#020617']} />
      <Stars radius={300} depth={60} count={6000} factor={4} saturation={0} fade speed={0.3} />
      <ambientLight intensity={0.15} />
      <Sun />
      {planets.map((p, i) => (
        <Planet key={p.id} planet={p} orbitRadius={positions[i]!.radius} orbitAngleOffset={(i * Math.PI) / 3} />
      ))}
      <EffectComposer>
        <Bloom intensity={1.0} luminanceThreshold={0.25} luminanceSmoothing={0.4} mipmapBlur />
        <Vignette darkness={0.6} offset={0.3} />
      </EffectComposer>
    </>
  )
}
