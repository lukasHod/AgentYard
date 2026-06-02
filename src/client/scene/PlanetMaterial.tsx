import { shaderMaterial } from '@react-three/drei'
import { extend } from '@react-three/fiber'
import { Color } from 'three'

// Tutorial: https://sangillee.com/2024-06-07-create-realistic-earth-with-shaders/
// Two-pass atmosphere: BackSide diffuse glow + FrontSide Fresnel rim, both
// masked to the sun-lit hemisphere via a sigmoid.
//
// NaN-safety: the tutorial formula uses pow(3*max(dot,0), 3) which is always
// ≥ 0 — never the 1-x pattern that blew up when x drifted above 1.0.

const VERT = /* glsl */`
varying vec3 vNormal;
varying vec3 vNormalView;
varying vec3 vPosition;
varying vec3 vWorldPos;

void main() {
  vNormal     = normalize(mat3(modelMatrix) * normal);
  vNormalView = normalize(normalMatrix * normal);
  vPosition   = normalize(vec3(modelViewMatrix * vec4(position, 1.0)).xyz);
  vWorldPos   = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// BackSide sphere ×1.05 — inner scatter glow
const ATMO_FRAG = /* glsl */`
uniform vec3  u_color;
uniform float u_brightness;

varying vec3 vNormal;
varying vec3 vNormalView;
varying vec3 vPosition;
varying vec3 vWorldPos;

void main() {
  // Sun is at world origin
  vec3  sunDir  = normalize(-vWorldPos);
  float cosAngle = dot(vNormal, sunDir);
  // Sigmoid: 1 on lit side, 0 on dark — +0.1 lets glow bleed past terminator
  float sunMask = 1.0 / (1.0 + exp(-7.0 * (cosAngle + 0.1)));

  // Glow peaks where viewing angle grazes the surface (limb)
  float raw = 3.0 * max(dot(vPosition, vNormalView), 0.0);
  float intensity = pow(raw, 3.0);

  gl_FragColor = vec4(u_color, intensity * u_brightness) * sunMask;
}
`


export const PlanetAtmoMaterial = shaderMaterial(
  { u_color: new Color(0.45, 0.55, 1.0), u_brightness: 1.0 },
  VERT,
  ATMO_FRAG,
)

extend({ PlanetAtmoMaterial })
