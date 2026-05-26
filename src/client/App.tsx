// src/client/App.tsx
import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  useSocketStore,
} from './state/socketStore'
import { initSocketClient } from './state/socketClient'
import { apiGet } from './api'
import type { FeatureSummary, PlanetSummary } from '../core/types'
import { Toasts } from './components/Toasts'
import { SolarSystemScene } from './scene/SolarSystemScene'
import { BackOutHandler } from './components/hud/BackOutHandler'
import { HudLayer } from './components/hud/HudLayer'
import { GlassPanel } from './components/glass/GlassPanel'

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
    initSocketClient()
  }, [])

  useEffect(() => {
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
      <div className="absolute inset-0">
        <Canvas camera={{ position: [0, 8, 24], fov: 45 }} dpr={[1, 2]}>
          <SolarSystemScene />
        </Canvas>
      </div>
      <HudLayer />
      <BackOutHandler />
      <Toasts />
    </main>
  )
}
