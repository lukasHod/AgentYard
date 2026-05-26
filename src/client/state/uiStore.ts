import { create } from 'zustand'

export type Focus =
  | { lod: 0 }
  | { lod: 1; planetId: number }
  | { lod: 1; sun: true }
  | { lod: 2; planetId: number; shipFeatureId: number; chatDroneId?: string }

const SPLITTER_KEY = 'agentyard.splitterRatio'
const readSplitter = (): number => {
  if (typeof localStorage === 'undefined') return 0.38
  const raw = localStorage.getItem(SPLITTER_KEY)
  const v = raw ? Number(raw) : 0.38
  return Number.isFinite(v) ? v : 0.38
}

interface UiState {
  focus: Focus
  splitterRatio: number
  notificationDeckOpen: boolean
  focusPlanet: (planetId: number) => void
  focusSun: () => void
  focusShip: (planetId: number, shipFeatureId: number, chatDroneId?: string) => void
  bindChatDrone: (droneId: string) => void
  back: () => void
  setSplitterRatio: (r: number) => void
  setNotificationDeckOpen: (open: boolean) => void
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export const useUiStore = create<UiState>((set, get) => ({
  focus: { lod: 0 },
  splitterRatio: readSplitter(),
  notificationDeckOpen: false,
  focusPlanet: (planetId) => set({ focus: { lod: 1, planetId } }),
  focusSun: () => set({ focus: { lod: 1, sun: true } }),
  focusShip: (planetId, shipFeatureId, chatDroneId) =>
    set({ focus: chatDroneId ? { lod: 2, planetId, shipFeatureId, chatDroneId } : { lod: 2, planetId, shipFeatureId } }),
  bindChatDrone: (droneId) => {
    const f = get().focus
    if (f.lod === 2) set({ focus: { ...f, chatDroneId: droneId } })
  },
  back: () => {
    const f = get().focus
    if (f.lod === 2) set({ focus: { lod: 1, planetId: f.planetId } })
    else if (f.lod === 1) set({ focus: { lod: 0 } })
    // lod 0: no-op
  },
  setSplitterRatio: (r) => {
    const clamped = clamp(r, 0.15, 0.85)
    if (typeof localStorage !== 'undefined') localStorage.setItem(SPLITTER_KEY, String(clamped))
    set({ splitterRatio: clamped })
  },
  setNotificationDeckOpen: (open) => set({ notificationDeckOpen: open }),
}))
