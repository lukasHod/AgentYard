import { useThree, useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { useUiStore } from '../state/uiStore'
import { cameraTargetForV2, type PlanetPositionLookup, type ShipPositionLookup } from './lib/cameraTargets'

interface Props {
  planetLookup: PlanetPositionLookup
  shipLookup: ShipPositionLookup
}

const DURATION = 0.8 // seconds

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function CameraRig({ planetLookup, shipLookup }: Props) {
  const { camera } = useThree()
  const focus = useUiStore((s) => s.focus)

  const fromPos = useRef(new Vector3().copy(camera.position))
  const fromLook = useRef(new Vector3(0, 0, 0))
  const toPos = useRef(new Vector3())
  const toLook = useRef(new Vector3())
  const t = useRef(1) // 1 = settled

  useEffect(() => {
    const target = cameraTargetForV2(focus, planetLookup, shipLookup)
    fromPos.current.copy(camera.position)
    // Approximate current lookAt from camera orientation
    const forward = new Vector3()
    camera.getWorldDirection(forward)
    fromLook.current.copy(camera.position).add(forward.multiplyScalar(10))
    toPos.current.set(...target.position)
    toLook.current.set(...target.lookAt)
    t.current = 0
  }, [focus, planetLookup, shipLookup, camera])

  useFrame((_, dt) => {
    if (t.current >= 1) return
    t.current = Math.min(1, t.current + dt / DURATION)
    const k = easeInOutCubic(t.current)
    camera.position.lerpVectors(fromPos.current, toPos.current, k)
    const lookAt = new Vector3().lerpVectors(fromLook.current, toLook.current, k)
    camera.lookAt(lookAt)
  })

  return null
}
