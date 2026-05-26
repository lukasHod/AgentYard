// src/client/scene/Sun.tsx
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { ShaderMaterial, Mesh, Color } from 'three'

const vert = `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const frag = `
  uniform float uTime;
  varying vec3 vPos;
  // Cheap noise — 3 octaves of sin warps
  float noise(vec3 p) {
    float n = sin(p.x * 2.0 + uTime * 0.4) + sin(p.y * 2.7 - uTime * 0.3) + sin(p.z * 3.1 + uTime * 0.2);
    return n / 3.0;
  }
  void main() {
    float n = noise(vPos * 1.3);
    vec3 base = mix(vec3(1.0, 0.6, 0.15), vec3(1.0, 0.9, 0.55), 0.5 + 0.5 * n);
    gl_FragColor = vec4(base, 1.0);
  }
`

export function Sun() {
  const meshRef = useRef<Mesh>(null)
  const matRef = useRef<ShaderMaterial>(null)
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: vert,
        fragmentShader: frag,
      }),
    [],
  )
  useFrame((_, dt) => {
    if (matRef.current) matRef.current.uniforms['uTime']!.value += dt
    if (meshRef.current) meshRef.current.rotation.y += dt * 0.02
  })
  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <sphereGeometry args={[2.4, 64, 64]} />
      <primitive ref={matRef} object={material} attach="material" />
      {/* Corona — additive, larger sphere with a soft glow material */}
      <pointLight intensity={3} distance={120} decay={1.5} color={new Color('#fbbf24')} />
    </mesh>
  )
}
