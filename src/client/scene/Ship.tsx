// src/client/scene/Ship.tsx
import { useGLTF, useAnimations } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import { Color, Group, Mesh, MeshStandardMaterial, Material } from 'three'
import type { FeatureSummary } from '../../core/types'
import { deriveShipParams } from './lib/shipParams'
import { useUiStore } from '../state/uiStore'

interface ShipProps {
  feature: FeatureSummary
  orbitRadius: number  // around the parent planet
  orbitAngle: number   // angle on the orbit ring
}

/**
 * One R3F ship for an active feature. The shared model is cloned per-instance so
 * animations + tints don't bleed across ships. We don't keep a heavy refs object;
 * the model owns its own animation via the baked animation track in the GLB.
 */
export function Ship({ feature, orbitRadius, orbitAngle }: ShipProps) {
  const params = useMemo(() => deriveShipParams(feature.id, feature.name), [feature.id, feature.name])
  const gltf = useGLTF(params.modelUrl)
  const groupRef = useRef<Group>(null)
  const focusShip = useUiStore((s) => s.focusShip)

  // Clone the loaded scene + override materials for hue tint. Memoized on
  // (gltf, hueShift) so we don't re-clone every render.
  const cloned = useMemo(() => {
    const c = gltf.scene.clone(true)
    const tint = new Color().setHSL(params.hueShift / 360, 0.6, 0.55)
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
          return clonedMat
        })
      } else if ((mat as MeshStandardMaterial).color) {
        const clonedMat = (mat as MeshStandardMaterial).clone()
        ;(clonedMat as MeshStandardMaterial).color.lerp(tint, 0.4)
        mesh.material = clonedMat
      }
    })
    return c
  }, [gltf.scene, params.hueShift])

  // Play the baked animation if present. drei's useAnimations needs the cloned
  // scene as the root so the action references our local nodes, not the source.
  const { actions, names } = useAnimations(gltf.animations, cloned)
  useEffect(() => {
    if (names.length === 0) return
    const first = actions[names[0]!]
    first?.reset().play()
    return () => {
      first?.stop()
    }
  }, [actions, names])

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
      <group scale={0.3}>
        <primitive object={cloned} />
      </group>
    </group>
  )
}

// Preload the model so the first feature doesn't block UI on click.
useGLTF.preload('/models/ships/ships.glb')
