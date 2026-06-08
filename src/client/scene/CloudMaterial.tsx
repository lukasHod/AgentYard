import { shaderMaterial } from '@react-three/drei'
import { extend } from '@react-three/fiber'
import { Color, Vector3 } from 'three'

const VERT = /* glsl */`
varying vec3 vPos;

void main() {
  vPos        = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */`
uniform vec3  u_seed;
uniform float u_coverage;
uniform float u_opacity;
uniform vec3  u_color;
uniform float u_time;

varying vec3 vPos;

float hash(vec3 p) {
  p  = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i),               hash(i + vec3(1,0,0)), u.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y),
    u.z
  );
}

float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    v += a * noise(p);
    p  = p * 2.0 + vec3(5.7, 3.2, 1.4);
    a *= 0.5;
  }
  return v;
}

void main() {
  // Fast layer: detailed cloud shapes + slow morphing drift
  float fast    = fbm(vPos * 2.5 + u_seed + vec3(u_time * 0.025, 0.0, u_time * 0.01));
  // Slow layer: large-scale formation / dissipation envelope
  float slow    = fbm(vPos * 1.2 + u_seed * 0.7 + vec3(0.0, u_time * 0.006, 0.0));
  // Combine: fast detail weighted by slow envelope
  float density = fast * (0.5 + 0.7 * slow);
  // Soft threshold: wispy edges, denser centres
  float alpha   = smoothstep(u_coverage - 0.15, u_coverage + 0.05, density) * u_opacity;
  gl_FragColor  = vec4(u_color, clamp(alpha, 0.0, 1.0));
}
`

export const CloudMaterial = shaderMaterial(
  {
    u_time:     0,
    u_seed:     new Vector3(0, 0, 0),
    u_coverage: 0.45,
    u_opacity:  0.85,
    u_color:    new Color(0.95, 0.95, 1.0),
  },
  VERT,
  FRAG,
)

extend({ CloudMaterial })

import type { ShaderMaterialProps } from '@react-three/fiber'

declare module '@react-three/fiber' {
  interface ThreeElements {
    cloudMaterial: ShaderMaterialProps & {
      u_time?: number
      u_seed?: import('three').Vector3
      u_coverage?: number
      u_opacity?: number
      u_color?: import('three').Color
    }
  }
}
