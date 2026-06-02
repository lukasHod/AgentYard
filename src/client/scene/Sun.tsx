// src/client/scene/Sun.tsx
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { ShaderMaterial, Mesh, Color, PointLight, Group } from 'three'
import { useUiStore } from '../state/uiStore'

const vert = `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const frag = `
  uniform float uTime;
  uniform float uBrightness;
  varying vec3 vPos;
  // Cheap noise — 3 octaves of sin warps
  float noise(vec3 p) {
    float n = sin(p.x * 2.0 + uTime * 0.4) + sin(p.y * 2.7 - uTime * 0.3) + sin(p.z * 3.1 + uTime * 0.2);
    return n / 3.0;
  }
  void main() {
    float n = noise(vPos * 1.3);
    vec3 base = mix(vec3(1.0, 0.6, 0.15), vec3(1.0, 0.9, 0.55), 0.5 + 0.5 * n);
    gl_FragColor = vec4(base * uBrightness, 1.0);
  }
`

// Brightness multiplier on the sun's shader output + corona point light.
// 1.0 at LOD 0 (default solar-system overview).
// 0.45 when the user has focused the sun itself — softens it so glass panels read.
// 0.3 when a planet or ship is focused — sun is just a background element.
const NORMAL_BRIGHTNESS = 1
const SUN_FOCUSED_BRIGHTNESS = 0.45
const BACKGROUND_BRIGHTNESS = 0.3

// When a planet/ship is focused the sun shrinks to a small backdrop so its
// motion across the field of view doesn't pull attention away from the work.
const BACKGROUND_SCALE = 0.1

const POINT_LIGHT_BASE = 3
const RESPONSE = 4 // ~250ms tween to target

export function Sun() {
  const groupRef = useRef<Group>(null)
  const meshRef = useRef<Mesh>(null)
  const matRef = useRef<ShaderMaterial>(null)
  const lightRef = useRef<PointLight>(null)
  const focusSun = useUiStore((s) => s.focusSun)
  const isSunFocused = useUiStore((s) => s.focus.lod === 1 && 'sun' in s.focus && s.focus.sun === true)
  const isOtherFocused = useUiStore(
    (s) => s.focus.lod === 2 || (s.focus.lod === 1 && 'planetId' in s.focus),
  )

  const brightness = useRef(1)
  const scale = useRef(1)

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uBrightness: { value: 1 } },
        vertexShader: vert,
        fragmentShader: frag,
      }),
    [],
  )

  useFrame((_, dt) => {
    if (matRef.current) matRef.current.uniforms['uTime']!.value += dt
    if (meshRef.current) meshRef.current.rotation.y += dt * 0.02

    const targetBrightness = isSunFocused
      ? SUN_FOCUSED_BRIGHTNESS
      : isOtherFocused
        ? BACKGROUND_BRIGHTNESS
        : NORMAL_BRIGHTNESS
    brightness.current += (targetBrightness - brightness.current) * Math.min(1, dt * RESPONSE)
    if (matRef.current) matRef.current.uniforms['uBrightness']!.value = brightness.current
    if (lightRef.current) lightRef.current.intensity = POINT_LIGHT_BASE * brightness.current

    const targetScale = isOtherFocused ? BACKGROUND_SCALE : 1
    scale.current += (targetScale - scale.current) * Math.min(1, dt * RESPONSE)
    if (groupRef.current) groupRef.current.scale.setScalar(scale.current)
  })

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        position={[0, 0, 0]}
        onClick={(e) => { e.stopPropagation(); focusSun() }}
      >
        <sphereGeometry args={[2.4, 64, 64]} />
        <primitive ref={matRef} object={material} attach="material" />
        {/* Corona — additive, larger sphere with a soft glow material */}
        <pointLight
          ref={lightRef}
          intensity={POINT_LIGHT_BASE}
          distance={120}
          decay={1.5}
          color={new Color('#fbbf24')}
        />
      </mesh>
    </group>
  )
}
