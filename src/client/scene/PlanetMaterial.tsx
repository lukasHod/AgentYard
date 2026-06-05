import { shaderMaterial } from '@react-three/drei'
import { extend } from '@react-three/fiber'
import { Color } from 'three'

// Atmospheric glow — adapted from sangillee.com's "realistic earth" shader.
//
// The tutorial renders a BackSide sphere with depthTest enabled and a
// view-space Fresnel that peaks behind the planet. That setup shimmers on
// the lit limb: the atmosphere's far hemisphere z-fights the planet's
// silhouette edge, and the per-pixel depth result flips every frame as the
// geometry rotates.
//
// Fix here:
//   • FrontSide sphere on a thin shell, depthTest DISABLED — removes every
//     depth-driven flip, so nothing can shimmer against the planet's edge.
//   • The glow is brightest right at the planet's limb (e == u_rimE, the
//     Fresnel value where the planet's silhouette projects onto this shell)
//     and fades OUTWARD into space, reaching 0 at u_outerE — well inside
//     the mesh silhouette so the outer edge stays soft (no shimmer).
//   • No sun-facing mask: the halo is a uniform ring visible from any camera
//     angle. This is essential for close-up planetary view where the camera
//     can approach from any side.
const VERT = /* glsl */`
varying vec3 vNormalView;
varying vec3 vViewDir;

void main() {
  vNormalView  = normalize(normalMatrix * normal);
  vec4 mv      = modelViewMatrix * vec4(position, 1.0);
  vViewDir     = normalize(mv.xyz);            // camera→fragment (view space)
  gl_Position  = projectionMatrix * mv;
}
`

const ATMO_FRAG = /* glsl */`
uniform vec3  u_color;
uniform float u_brightness;   // dim multiplier when the planet is defocused
uniform float u_intensity;    // overall glow strength
uniform float u_power;        // outward falloff curve — higher = softer landing into space
uniform float u_rimE;         // Fresnel value where the planet's limb projects onto this shell
uniform float u_outerE;       // Fresnel value where the glow has fully faded to 0

varying vec3 vNormalView;
varying vec3 vViewDir;

void main() {
  // facing: 1 at the disc centre (normal points at camera) → 0 at the
  // silhouette (normal perpendicular to view).  e is the inverse.
  float facing = clamp(-dot(vViewDir, vNormalView), 0.0, 1.0);
  float e      = 1.0 - facing;

  // Glow brightest at the planet's limb (e == u_rimE), fading OUTWARD into
  // space and reaching 0 at u_outerE — which sits WELL inside the mesh
  // silhouette (e → 1). That matters because near the silhouette the
  // screen-space gradient of e explodes; fading out before that zone keeps
  // the outer edge soft, and leaves the geometry edge dark (no shimmer).
  float t       = clamp((e - u_rimE) / (u_outerE - u_rimE), 0.0, 1.0); // 0 at limb → 1 at outer edge
  float outward = pow(1.0 - t, u_power);                     // soft fade to 0 by u_outerE
  float inner   = smoothstep(u_rimE - 0.08, u_rimE, e);      // tight fade onto the disc edge, 0 toward centre
  float glow    = outward * inner;

  float alpha = glow * u_intensity * u_brightness;
  gl_FragColor = vec4(u_color, clamp(alpha, 0.0, 1.0));
}
`

export const PlanetAtmoMaterial = shaderMaterial(
  {
    u_color: new Color(0.7, 0.75, 0.8),
    u_brightness: 1.0,
    u_intensity: 0.35,
    u_power: 2.0,
    u_rimE: 0.4,    // overwritten per-planet from the shell scale (see Planet.tsx)
    u_outerE: 0.46, // glow fades to 0 here — close to the rim for a thin halo, clear of the silhouette
  },
  VERT,
  ATMO_FRAG,
)

extend({ PlanetAtmoMaterial })
