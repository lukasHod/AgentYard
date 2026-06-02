// src/client/scene/SolarSystemScene.tsx
import { useCallback, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { Sun } from './Sun'
import { Planet } from './Planet'
import { CameraRig } from './CameraRig'
import { planetOrbitPositions } from './lib/orbits'
import { usePlanets } from '../state/socketStore'
import { useUiStore } from '../state/uiStore'
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
      <OverviewZoomControls />
      <EffectComposer>
        <Bloom intensity={1.0} luminanceThreshold={0.25} luminanceSmoothing={0.4} mipmapBlur />
        <Vignette darkness={0.6} offset={0.3} />
      </EffectComposer>
    </>
  )
}

/**
 * Wheel-to-zoom-toward-cursor for the system-overview camera.
 *
 * Lives inside <Canvas> so it has access to the active camera + canvas
 * DOM element. Raycasts the cursor onto a plane that passes through the
 * current lookAt target and is perpendicular to the camera forward, then
 * applies a uniform scale around that world point — this is the formula
 * that keeps the world point under the cursor pinned during zoom.
 *
 * Only active at LOD 0 — at planet/ship focus the cinematic framing owns
 * the camera, and a stray wheel input shouldn't fight it.
 */
function OverviewZoomControls() {
  const { camera, gl } = useThree()
  const focusLod = useUiStore((s) => s.focus.lod)

  useEffect(() => {
    if (focusLod !== 0) return
    const canvas = gl.domElement
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const plane = new Plane()
    const forward = new Vector3()
    const hit = new Vector3()
    const targetVec = new Vector3()

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      const { viewTargetX, viewTargetY, viewTargetZ } = useUiStore.getState()
      targetVec.set(viewTargetX, viewTargetY, viewTargetZ)
      camera.getWorldDirection(forward)
      plane.setFromNormalAndCoplanarPoint(forward.clone().negate(), targetVec)
      raycaster.setFromCamera(ndc, camera)
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      // 1 wheel notch ≈ 100 deltaY. 0.0015 → ~14% zoom step per notch.
      const factor = Math.exp(e.deltaY * 0.0015)
      useUiStore.getState().zoomTowardWorld(hit.x, hit.y, hit.z, factor)
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [focusLod, camera, gl])

  return null
}
