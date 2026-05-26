// src/client/scene/SolarSystemScene.tsx
import { Stars } from '@react-three/drei'

export function SolarSystemScene() {
  return (
    <>
      <color attach="background" args={['#020617']} />
      <Stars
        radius={300}
        depth={60}
        count={6000}
        factor={4}
        saturation={0}
        fade
        speed={0.3}
      />
      <ambientLight intensity={0.15} />
    </>
  )
}
