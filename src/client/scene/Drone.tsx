// src/client/scene/Drone.tsx
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Suspense, useMemo, useRef } from 'react'
import { GlbErrorBoundary } from './ErrorBoundaries'
import { Color, Group, Mesh, MeshStandardMaterial, Material } from 'three'
import type { SessionDescriptor } from '../../core/types'

interface DroneProps {
  session: SessionDescriptor
  orbitRadius: number
  orbitAngle: number
  bobPhase: number
  pending: boolean
  onClick?: () => void
}

const DRONE_URL = '/models/drones/drone.glb'

function DroneImpl({ session, orbitRadius, orbitAngle, bobPhase, pending, onClick }: DroneProps) {
  const isLeader = session.role === 'leader'
  const gltf = useGLTF(DRONE_URL)
  const ref = useRef<Group>(null)
  const matsRef = useRef<MeshStandardMaterial[]>([])

  // Clone scene + collect material refs so useFrame can animate emissive state.
  const cloned = useMemo(() => {
    const c = gltf.scene.clone(true)
    const mats: MeshStandardMaterial[] = []
    const accent = new Color(isLeader ? '#fb923c' : '#38bdf8')
    c.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      const mat = mesh.material as Material | Material[]
      const apply = (m: Material) => {
        const std = (m as MeshStandardMaterial).clone()
        if (std.emissive) {
          std.emissive = accent.clone()
          std.emissiveIntensity = 0.6
        }
        mats.push(std)
        return std
      }
      if (Array.isArray(mat)) {
        mesh.material = mat.map(apply)
      } else {
        mesh.material = apply(mat)
      }
    })
    matsRef.current = mats
    return c
  }, [gltf.scene, isLeader])

  // Drones are children of the Ship's scaled group (scale = BASE_SCALE ≈ 0.03).
  // These local-scale values compensate so drones remain visible at LOD 2.
  const baseScale = isLeader ? 0.77 : 0.55  // 10 % bigger than previous 0.7 / 0.5

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (ref.current) {
      ref.current.position.x = Math.cos(orbitAngle + t * 0.2) * orbitRadius
      ref.current.position.z = Math.sin(orbitAngle + t * 0.2) * orbitRadius
      ref.current.position.y = Math.sin(t * 2 + bobPhase) * 0.1
      if (pending) {
        const pulse = 1 + 0.15 * Math.sin(t * 6)
        ref.current.scale.setScalar(pulse * baseScale)
      } else {
        ref.current.scale.setScalar(baseScale)
      }
    }
    if (pending) {
      const flash = 0.6 + 0.4 * Math.sin(t * 6)
      matsRef.current.forEach((m) => {
        m.emissive.set('#f43f5e')
        m.emissiveIntensity = flash
      })
    } else {
      matsRef.current.forEach((m) => {
        m.emissive.set(isLeader ? '#fb923c' : '#38bdf8')
        m.emissiveIntensity = 0.6
      })
    }
  })

  return (
    <group ref={ref} onClick={(e) => { e.stopPropagation(); onClick?.() }}>
      <primitive object={cloned} />
    </group>
  )
}

function GhostDrone() {
  return (
    <mesh>
      <boxGeometry args={[0.15, 0.15, 0.15]} />
      <meshStandardMaterial color="#475569" emissive="#94a3b8" emissiveIntensity={0.4} />
    </mesh>
  )
}

export function Drone(props: DroneProps) {
  return (
    <GlbErrorBoundary fallback={<GhostDrone />}>
      <Suspense fallback={<GhostDrone />}>
        <DroneImpl {...props} />
      </Suspense>
    </GlbErrorBoundary>
  )
}

useGLTF.preload(DRONE_URL)
