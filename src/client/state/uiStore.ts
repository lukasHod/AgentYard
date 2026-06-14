import { create } from 'zustand'

export type Focus =
  | { lod: 0 }
  | { lod: 1; planetId: number }
  | { lod: 1; sun: true }
  | { lod: 2; planetId: number; shipFeatureId: number }

/** Tabs available on the LOD-1 info panel. */
export type InfoTab =
  | 'features'
  | 'tools'
  | 'plans'
  | 'description'
  | 'run'
  | 'notifications'
  | 'handoffs'
  | 'terminals'

const SPLITTER_KEY = 'agentyard.splitterRatio.v2'
const readSplitter = (): number => {
  if (typeof localStorage === 'undefined') return 0.5
  const raw = localStorage.getItem(SPLITTER_KEY)
  const v = raw ? Number(raw) : 0.5
  return Number.isFinite(v) ? v : 0.5
}

interface UiState {
  focus: Focus
  splitterRatio: number
  notificationDeckOpen: boolean
  /**
   * Visibility of the info (left) panel when at LOD 1/2. Closing it lets the
   * user see the 3D scene (orbiting ships / drones) on that side.
   */
  infoPanelOpen: boolean
  /** Visibility of the chat (right) panel. Same rationale as infoPanelOpen. */
  chatPanelOpen: boolean
  /** Selected tab for the info panel. Persists across panel hide/reopen. */
  infoTab: InfoTab
  /** Per-planet selected terminal session — when set, the chat panel renders
   *  the terminal instead of the agent chat. Cleared with selectTerminal(planetId, null). */
  selectedTerminalByPlanet: Record<number, string>
  /** Per-feature selected workspace tab (terminal session id). Falls back to
   *  the leader when the stored id is no longer in the list. */
  selectedTabByFeature: Record<number, string>
  /** Yaw (rad) of the system-overview camera around the sun. 0 = default view. */
  viewYaw: number
  /** Pitch (rad) of the system-overview camera. Clamped to avoid pole flip. */
  viewPitch: number
  /** Distance from the overview lookAt point. Clamped to [MIN, MAX]_RADIUS. */
  viewRadius: number
  /** LookAt point for the overview camera. Drifts during zoom-to-cursor. */
  viewTargetX: number
  viewTargetY: number
  viewTargetZ: number
  focusPlanet: (planetId: number) => void
  focusSun: () => void
  focusShip: (planetId: number, shipFeatureId: number) => void
  /**
   * Navigate directly to a specific feature and, if provided, select a
   * particular terminal tab within it. All state updates are atomic so React
   * sees a single render. Use this for notification-click routing.
   */
  navigateTo: (target: {
    planetId: number
    featureId: number
    terminalSessionId?: string | null
  }) => void
  back: () => void
  setSplitterRatio: (r: number) => void
  setNotificationDeckOpen: (open: boolean) => void
  setInfoPanelOpen: (open: boolean) => void
  setChatPanelOpen: (open: boolean) => void
  /** Closes both side panels — enters fully-cinematic view. */
  hideAllPanels: () => void
  /** Opens the info panel and switches it to `tab`. */
  openInfoTab: (tab: InfoTab) => void
  /** Opens the chat panel. */
  openChat: () => void
  /** Sets (or clears) the planet's active terminal session. */
  selectTerminal: (planetId: number, sessionId: string | null) => void
  /** Sets (or clears) the active workspace tab for a feature. */
  selectFeatureTab: (featureId: number, sessionId: string | null) => void
  orbitView: (dYaw: number, dPitch: number) => void
  /**
   * Zoom toward a world-space point. Moves both lookAt target and camera
   * toward `(px, py, pz)` so that the world point under the cursor stays
   * pinned to the cursor. `factor` < 1 zooms in, > 1 zooms out.
   */
  zoomTowardWorld: (px: number, py: number, pz: number, factor: number) => void
  resetView: () => void
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

const DEFAULT_PITCH = Math.atan2(8, 24) // matches initial camera [0, 8, 24]
const PITCH_LIMIT = Math.PI / 2 - 0.05
const DEFAULT_RADIUS = Math.hypot(8, 24)
const MIN_RADIUS = 5
const MAX_RADIUS = 120

export const useUiStore = create<UiState>((set, get) => ({
  focus: { lod: 0 },
  splitterRatio: readSplitter(),
  notificationDeckOpen: false,
  viewYaw: 0,
  viewPitch: DEFAULT_PITCH,
  viewRadius: DEFAULT_RADIUS,
  viewTargetX: 0,
  viewTargetY: 0,
  viewTargetZ: 0,
  infoPanelOpen: true,
  chatPanelOpen: true,
  infoTab: 'features',
  selectedTerminalByPlanet: {},
  selectedTabByFeature: {},
  // Focus actions reset panel visibility only when the focus *actually changes*.
  // Re-clicking the already-focused planet/ship/sun is a no-op for the panel
  // state, so a user who has hidden the panels stays in the cinematic view.
  focusPlanet: (planetId) => {
    const cur = get().focus
    const same = cur.lod === 1 && 'planetId' in cur && cur.planetId === planetId
    set({
      focus: { lod: 1, planetId },
      ...(same ? {} : { infoPanelOpen: true, chatPanelOpen: true }),
    })
  },
  focusSun: () => {
    const cur = get().focus
    const same = cur.lod === 1 && 'sun' in cur && cur.sun === true
    set({
      focus: { lod: 1, sun: true },
      ...(same ? {} : { infoPanelOpen: true, chatPanelOpen: true }),
    })
  },
  focusShip: (planetId, shipFeatureId) => {
    const cur = get().focus
    const same =
      cur.lod === 2 && cur.planetId === planetId && cur.shipFeatureId === shipFeatureId
    set({
      focus: { lod: 2, planetId, shipFeatureId },
      ...(same ? {} : { infoPanelOpen: true, chatPanelOpen: true }),
    })
  },
  navigateTo: ({ planetId, featureId, terminalSessionId }) => {
    const cur = get().focus
    const alreadyHere =
      cur.lod === 2 && cur.planetId === planetId && cur.shipFeatureId === featureId
    const tabUpdate = terminalSessionId
      ? { selectedTabByFeature: { ...get().selectedTabByFeature, [featureId]: terminalSessionId } }
      : {}
    set({
      focus: { lod: 2, planetId, shipFeatureId: featureId },
      chatPanelOpen: true,
      ...(alreadyHere ? {} : { infoPanelOpen: true }),
      ...tabUpdate,
    })
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
  setInfoPanelOpen: (open) => set({ infoPanelOpen: open }),
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
  hideAllPanels: () => set({ infoPanelOpen: false, chatPanelOpen: false }),
  openInfoTab: (tab) => set({ infoPanelOpen: true, infoTab: tab }),
  openChat: () => set({ chatPanelOpen: true }),
  selectTerminal: (planetId, sessionId) =>
    set((s) => {
      const next = { ...s.selectedTerminalByPlanet }
      if (sessionId) next[planetId] = sessionId
      else delete next[planetId]
      return { selectedTerminalByPlanet: next, chatPanelOpen: sessionId ? true : s.chatPanelOpen }
    }),
  selectFeatureTab: (featureId, sessionId) =>
    set((s) => {
      const next = { ...s.selectedTabByFeature }
      if (sessionId) next[featureId] = sessionId
      else delete next[featureId]
      return { selectedTabByFeature: next }
    }),
  orbitView: (dYaw, dPitch) => {
    const { viewYaw, viewPitch } = get()
    set({
      viewYaw: viewYaw + dYaw,
      viewPitch: clamp(viewPitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT),
    })
  },
  zoomTowardWorld: (px, py, pz, factor) => {
    const { viewRadius, viewTargetX, viewTargetY, viewTargetZ } = get()
    const newRadius = clamp(viewRadius * factor, MIN_RADIUS, MAX_RADIUS)
    // Use the clamped radius ratio so the cursor point stays pinned even
    // at the zoom limits (otherwise the target would drift past the pin).
    const k = newRadius / viewRadius
    set({
      viewRadius: newRadius,
      viewTargetX: px + (viewTargetX - px) * k,
      viewTargetY: py + (viewTargetY - py) * k,
      viewTargetZ: pz + (viewTargetZ - pz) * k,
    })
  },
  resetView: () =>
    set({
      viewYaw: 0,
      viewPitch: DEFAULT_PITCH,
      viewRadius: DEFAULT_RADIUS,
      viewTargetX: 0,
      viewTargetY: 0,
      viewTargetZ: 0,
    }),
}))
