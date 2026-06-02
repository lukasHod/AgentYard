import { useThree, useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { useUiStore } from '../state/uiStore'
import { cameraTargetForV2, type PlanetPositionLookup, type ShipPositionLookup } from './lib/cameraTargets'

interface Props {
  planetLookup: PlanetPositionLookup
  shipLookup: ShipPositionLookup
}

const DURATION = 0.8 // seconds — initial dolly transition

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Drives the camera from the uiStore.focus state.
 *
 * On focus change: kick a 0.8s easeInOutCubic dolly from the camera's
 * current position to the focus target.
 *
 * After the dolly settles: continue sampling the target every frame and
 * snap the camera onto it. Because Planet/Ship publish their *live* world
 * positions to the registry, the camera follows orbital motion — the
 * focused planet (or ship) appears stationary from the user's POV.
 */
export function CameraRig({ planetLookup, shipLookup }: Props) {
  const { camera } = useThree()
  const focus = useUiStore((s) => s.focus)

  const fromPos = useRef(new Vector3().copy(camera.position))
  const fromLook = useRef(new Vector3(0, 0, 0))
  const toPos = useRef(new Vector3())
  const toLook = useRef(new Vector3())
  const lookAtScratch = useRef(new Vector3())
  const t = useRef(1) // 1 = settled

  // Kick a new dolly transition whenever focus changes. The destination is
  // recomputed each frame in useFrame; here we only snapshot `from` and
  // reset the easing timer.
  useEffect(() => {
    fromPos.current.copy(camera.position)
    const forward = new Vector3()
    camera.getWorldDirection(forward)
    fromLook.current.copy(camera.position).add(forward.multiplyScalar(10))
    t.current = 0
  }, [focus, camera])

  useFrame((_, dt) => {
    // Live target — re-sampled every frame so orbital motion is followed.
    const target = cameraTargetForV2(focus, planetLookup, shipLookup)
    toPos.current.set(...target.position)
    toLook.current.set(...target.lookAt)

    if (t.current < 1) {
      // Initial dolly: ease from snapshot `from` to the live `to`.
      t.current = Math.min(1, t.current + dt / DURATION)
      const k = easeInOutCubic(t.current)
      camera.position.lerpVectors(fromPos.current, toPos.current, k)
      lookAtScratch.current.lerpVectors(fromLook.current, toLook.current, k)
      camera.lookAt(lookAtScratch.current)
    } else {
      // Settled: lock onto the moving target each frame so the focused
      // object stays centred even as it orbits the sun.
      camera.position.copy(toPos.current)
      camera.lookAt(toLook.current)
    }
  })

  return null
}
