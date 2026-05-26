// src/client/App.tsx
import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  useSocketStore,
} from './state/socketStore'
import { initSocketClient } from './state/socketClient'
import { apiGet } from './api'
import type { FeatureSummary, PlanetSummary } from '../core/types'
import { Toasts } from './components/Toasts'
import { SolarSystemScene } from './scene/SolarSystemScene'

export function App() {
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

  return (
    <main className="min-h-screen w-screen bg-black overflow-hidden font-sans">
      <div className="absolute inset-0">
        <Canvas camera={{ position: [0, 8, 24], fov: 45 }} dpr={[1, 2]}>
          <SolarSystemScene />
        </Canvas>
      </div>
      <Toasts />
    </main>
  )
}
