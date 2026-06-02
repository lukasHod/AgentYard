// src/client/App.tsx
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  useSocketStore,
} from './state/socketStore'
import { initSocketClient } from './state/socketClient'
import { apiGet } from './api'
import type { FeatureSummary, PlanetSummary } from '../core/types'
import { MOCK_ENABLED, installMockData } from './state/mockSeed'
import { Toasts } from './components/Toasts'
import { SolarSystemScene } from './scene/SolarSystemScene'
import { BackOutHandler } from './components/hud/BackOutHandler'
import { HudLayer } from './components/hud/HudLayer'
import { GlassPanel } from './components/glass/GlassPanel'
import { useUiStore } from './state/uiStore'

// Pixels of drag → radians of camera orbit. Empirically pleasant on a
// 1080p display; horizontal motion sweeps the full system in ~750 px.
const ORBIT_SENSITIVITY = 0.005

export function App() {
  const webglOK = useMemo(() => {
    try {
      const c = document.createElement('canvas')
      return !!c.getContext('webgl2')
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    if (MOCK_ENABLED) {
      installMockData()
      return
    }
    initSocketClient()
  }, [])

  useEffect(() => {
    if (MOCK_ENABLED) return
    void (async () => {
      const planetsRes = await apiGet<PlanetSummary[]>('/api/planets')
      if (!planetsRes.ok) return
      useSocketStore.getState().setPlanets(planetsRes.data)
      const featureMap = new Map<number, FeatureSummary[]>()
      await Promise.all(
        planetsRes.data.map(async (p) => {
          const fs = await apiGet<FeatureSummary[]>(`/api/planets/${p.id}/features`)
          featureMap.set(p.id, fs.ok ? fs.data : [])
        }),
      )
      useSocketStore.getState().setFeatures(featureMap)
    })()
  }, [])

  if (!webglOK) {
    return (
      <main className="min-h-screen w-screen bg-black flex items-center justify-center">
        <GlassPanel className="px-6 py-4 text-slate-200 text-sm">
          AgentYard requires WebGL 2. Please update your browser or GPU drivers.
        </GlassPanel>
      </main>
    )
  }

  return (
    <main className="min-h-screen w-screen bg-black overflow-hidden font-sans">
      <CanvasHost />
      <HudLayer />
      <BackOutHandler />
      <Toasts />
    </main>
  )
}

/**
 * Right-mouse-button drag → orbits the system-overview camera around the
 * sun. Lets the user reveal planets occluded by the sun without zooming
 * into one. Only meaningful in overview (lod 0); CameraRig ignores
 * viewYaw/viewPitch at other LODs.
 */
// Max ms between two right-clicks (no significant drag) that count as a
// double-click → resetView. The browser doesn't fire dblclick for the
// right button, so we detect it ourselves.
const DOUBLE_CLICK_MS = 300
// Drag movement above this many CSS px disqualifies a release from being
// treated as a "click" for double-click detection.
const CLICK_MAX_DRAG_PX = 4

function CanvasHost() {
  const dragRef = useRef<{
    x: number
    y: number
    pointerId: number
    moved: number
  } | null>(null)
  const lastClickRef = useRef(0)
  const orbitView = useUiStore((s) => s.orbitView)
  const resetView = useUiStore((s) => s.resetView)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 2) return
    dragRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, moved: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      d.x = e.clientX
      d.y = e.clientY
      d.moved += Math.abs(dx) + Math.abs(dy)
      // Drag right → yaw view to the right (camera orbits left around sun).
      // Drag up → pitch view up (camera rises).
      orbitView(-dx * ORBIT_SENSITIVITY, -dy * ORBIT_SENSITIVITY)
    },
    [orbitView],
  )

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      const wasClick = d.moved <= CLICK_MAX_DRAG_PX
      dragRef.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      if (!wasClick) {
        lastClickRef.current = 0
        return
      }
      const now = performance.now()
      if (now - lastClickRef.current <= DOUBLE_CLICK_MS) {
        resetView()
        lastClickRef.current = 0
      } else {
        lastClickRef.current = now
      }
    },
    [resetView],
  )

  return (
    <div
      className="absolute inset-0"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        camera={{ position: [0, 8, 24], fov: 45 }}
        dpr={[1, 2]}
        onPointerMissed={() => {
          // Outside-click on the 3D scene (no mesh hit): if any focused
          // panel is open, close them all so the user sees the scene.
          const s = useUiStore.getState()
          if (s.focus.lod >= 1 && (s.infoPanelOpen || s.chatPanelOpen)) {
            s.hideAllPanels()
          }
        }}
      >
        <SolarSystemScene />
      </Canvas>
    </div>
  )
}
