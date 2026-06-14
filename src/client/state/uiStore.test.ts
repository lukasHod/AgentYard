import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from './uiStore'

describe('uiStore.focus reducer', () => {
  beforeEach(() => {
    useUiStore.setState({ focus: { lod: 0 }, splitterRatio: 0.38, notificationDeckOpen: false })
  })

  it('starts at LOD 0', () => {
    expect(useUiStore.getState().focus).toEqual({ lod: 0 })
  })

  it('focusPlanet sets LOD 1 on a planet', () => {
    useUiStore.getState().focusPlanet(42)
    expect(useUiStore.getState().focus).toEqual({ lod: 1, planetId: 42 })
  })

  it('focusSun sets LOD 1 sun-special state', () => {
    useUiStore.getState().focusSun()
    expect(useUiStore.getState().focus).toEqual({ lod: 1, sun: true })
  })

  it('focusShip sets LOD 2 on (planet, feature)', () => {
    useUiStore.getState().focusShip(42, 7)
    expect(useUiStore.getState().focus).toEqual({ lod: 2, planetId: 42, shipFeatureId: 7 })
  })

  it('back() pops one LOD level', () => {
    useUiStore.getState().focusShip(42, 7)
    useUiStore.getState().back()
    expect(useUiStore.getState().focus).toEqual({ lod: 1, planetId: 42 })
    useUiStore.getState().back()
    expect(useUiStore.getState().focus).toEqual({ lod: 0 })
    useUiStore.getState().back()
    expect(useUiStore.getState().focus).toEqual({ lod: 0 }) // idempotent at root
  })

  it('clamps splitterRatio to [0.15, 0.85]', () => {
    useUiStore.getState().setSplitterRatio(0.05)
    expect(useUiStore.getState().splitterRatio).toBe(0.15)
    useUiStore.getState().setSplitterRatio(0.95)
    expect(useUiStore.getState().splitterRatio).toBe(0.85)
    useUiStore.getState().setSplitterRatio(0.5)
    expect(useUiStore.getState().splitterRatio).toBe(0.5)
  })
})
