// src/client/scene/Ship.tsx
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { GlbErrorBoundary } from './ErrorBoundaries'
import { Color, Group, Mesh, MeshStandardMaterial, Material, Vector3 } from 'three'
import type { FeatureSummary } from '../../core/types'
import { deriveShipParams } from './lib/shipParams'
import { useUiStore } from '../state/uiStore'
import { registerShipPosition } from './lib/positionRegistry'

type Phase = 'spawning' | 'idle' | 'completing' | 'failing'

interface ShipProps {
  feature: FeatureSummary
  orbitRadius: number  // around the parent planet
  orbitAngle: number   // angle on the orbit ring
  /** Called once the despawn animation finishes so Planet can unmount us. */
  onDespawned?: () => void
}

const SPAWN_DURATION = 0.4
const FLASH_DURATION = 0.2
const COMPLETE_FADE_DURATION = 1.5
const FAIL_FADE_DURATION = 2.0

const FLASH_COMPLETE = new Color('#67e8f9')
const FLASH_FAIL = new Color('#fb7185')

// ~5 % of a typical planet diameter (planet radius 0.8–1.2, diameter 2 units → 0.1 units target).
const BASE_SCALE = 0.0255  // 15 % smaller than previous 0.03

/**
 * One R3F ship for an active feature. The shared model is cloned per-instance so
 * animations + tints don't bleed across ships. We don't keep a heavy refs object;
 * the model owns its own animation via the baked animation track in the GLB.
 *
 * Lifecycle phases:
 *  spawning  → scale 0→BASE_SCALE + opacity 0→1 over SPAWN_DURATION
 *  idle      → steady, no animation
 *  completing → cyan flash (FLASH_DURATION) then fade-out (COMPLETE_FADE_DURATION), then onDespawned
 *  failing    → rose flash (FLASH_DURATION) then fade-out (FAIL_FADE_DURATION), then onDespawned
 */
function ShipImpl({ feature, orbitRadius, orbitAngle, onDespawned }: ShipProps) {
  const params = useMemo(() => deriveShipParams(feature.id, feature.name), [feature.id, feature.name])
  const gltf = useGLTF(params.modelUrl)
  const groupRef = useRef<Group>(null)
  const focusShip = useUiStore((s) => s.focusShip)

  // Lifecycle state.
  const [phase, setPhase] = useState<Phase>('spawning')
  const phaseStartRef = useRef<number | null>(null)
  // Track whether onDespawned has been called to avoid calling it every frame.
  const despawnedCalledRef = useRef(false)
  const matsRef = useRef<MeshStandardMaterial[]>([])

  // Expose the ship's live world position so the camera rig can frame it as
  // it orbits with its planet.
  useEffect(() => {
    const out = new Vector3()
    return registerShipPosition(feature.planetId, feature.id, () => {
      if (!groupRef.current) return null
      groupRef.current.getWorldPosition(out)
      return out
    })
  }, [feature.planetId, feature.id])

  // Watch feature.status to kick off despawn animation.
  useEffect(() => {
    if (feature.status === 'complete' && phase !== 'completing') {
      setPhase('completing')
    } else if (feature.status === 'failed' && phase !== 'failing') {
      setPhase('failing')
    }
  }, [feature.status, phase])

  // Reset phaseStart and despawn guard whenever phase changes.
  useEffect(() => {
    phaseStartRef.current = null
    if (phase !== 'completing' && phase !== 'failing') {
      despawnedCalledRef.current = false
    }
  }, [phase])

  // Clone the loaded scene + override materials for hue tint.
  // Also marks materials transparent so opacity changes take effect.
  const cloned = useMemo(() => {
    const c = gltf.scene.clone(true)
    const tint = new Color().setHSL(params.hueShift / 360, 0.6, 0.55)
    const mats: MeshStandardMaterial[] = []
    c.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      const mat = mesh.material as Material | Material[]
      if (Array.isArray(mat)) {
        mesh.material = mat.map((m) => {
          const clonedMat = (m as MeshStandardMaterial).clone()
          if ((clonedMat as MeshStandardMaterial).color) {
            (clonedMat as MeshStandardMaterial).color.lerp(tint, 0.4)
          }
          clonedMat.transparent = true
          clonedMat.opacity = 1
          mats.push(clonedMat)
          return clonedMat
        })
      } else if ((mat as MeshStandardMaterial).color) {
        const clonedMat = (mat as MeshStandardMaterial).clone()
        ;(clonedMat as MeshStandardMaterial).color.lerp(tint, 0.4)
        clonedMat.transparent = true
        clonedMat.opacity = 1
        mats.push(clonedMat)
        mesh.material = clonedMat
      }
    })
    matsRef.current = mats
    return c
  }, [gltf.scene, params.hueShift])

  // Baked GLB animation intentionally left unplayed: ships stay still.

  // Drive lifecycle animation each frame.
  useFrame(({ clock }) => {
    if (!groupRef.current) return
    if (phaseStartRef.current === null) phaseStartRef.current = clock.elapsedTime
    const t = clock.elapsedTime - phaseStartRef.current

    if (phase === 'spawning') {
      const progress = Math.min(1, t / SPAWN_DURATION)
      // Smoothstep easing: p² × (3 - 2p)
      const eased = progress * progress * (3 - 2 * progress)
      groupRef.current.scale.setScalar(BASE_SCALE * eased)
      matsRef.current.forEach((m) => { m.opacity = eased })
      if (progress >= 1) setPhase('idle')
    } else if (phase === 'idle') {
      groupRef.current.scale.setScalar(BASE_SCALE)
      matsRef.current.forEach((m) => { m.opacity = 1 })
    } else if (phase === 'completing' || phase === 'failing') {
      const fadeDuration = phase === 'completing' ? COMPLETE_FADE_DURATION : FAIL_FADE_DURATION
      const flashColor = phase === 'completing' ? FLASH_COMPLETE : FLASH_FAIL

      if (t < FLASH_DURATION) {
        // Flash phase: emissive glow fades from full → 0 over flash window.
        const flashIntensity = (1 - t / FLASH_DURATION) * 1.5
        matsRef.current.forEach((m) => {
          if (m.emissive !== undefined) {
            m.emissive.copy(flashColor)
            m.emissiveIntensity = flashIntensity
          }
          m.opacity = 1
        })
      } else {
        // Fade-out phase.
        const fadeProgress = Math.min(1, (t - FLASH_DURATION) / fadeDuration)
        matsRef.current.forEach((m) => {
          m.opacity = 1 - fadeProgress
          if (m.emissive !== undefined) m.emissiveIntensity = 0
        })
        if (fadeProgress >= 1 && !despawnedCalledRef.current) {
          despawnedCalledRef.current = true
          onDespawned?.()
        }
      }
    }
  })

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    focusShip(feature.planetId, feature.id)
  }

  return (
    <group
      ref={groupRef}
      position={[Math.cos(orbitAngle) * orbitRadius, 0, Math.sin(orbitAngle) * orbitRadius]}
      onClick={handleClick}
    >
      {/* groupRef controls scale; inner group is unscaled relative to parent */}
      <group>
        {/* Dedicated fill light so the ship is visible even in planet shadow */}
        <pointLight intensity={0.5} distance={3} color="#c8d8ff" />
        <primitive object={cloned} />
      </group>
    </group>
  )
}

function GhostShip() {
  return (
    <mesh>
      <boxGeometry args={[0.4, 0.4, 0.4]} />
      <meshStandardMaterial color="#475569" emissive="#94a3b8" emissiveIntensity={0.4} />
    </mesh>
  )
}

export function Ship(props: ShipProps) {
  return (
    <GlbErrorBoundary fallback={<GhostShip />}>
      <Suspense fallback={<GhostShip />}>
        <ShipImpl {...props} />
      </Suspense>
    </GlbErrorBoundary>
  )
}

// Preload the model so the first feature doesn't block UI on click.
useGLTF.preload('/models/ships/ships.glb')
