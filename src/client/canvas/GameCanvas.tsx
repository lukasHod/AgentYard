import { useCallback, useEffect, useRef, useState } from 'react'
import { Application } from 'pixi.js'
import type {
  FeatureSummary,
  SessionDescriptor,
  PlanetSummary,
} from '../../core/types'
import { GalaxyScene, type PlanetMood } from './galaxyScene'
import { DockScene, type DockDroneSpec } from './dockScene'
import { type AgentChatMessage, type AgentChatPending } from '../components/AgentChat'
import { type PlanetPanelTab } from '../components/PlanetDetailsPanel'
import { isAudioMuted, playClarificationChime, setAudioMuted } from './chime'
import { GameHud, type Tooltip } from './GameHud'
import { useGameHud } from './useGameHud'

const COCKPIT_PANEL_WIDTH = 480

interface Props {
  planets: PlanetSummary[]
  features: Map<number, FeatureSummary[]>
  sessions: SessionDescriptor[]
  transcripts: Map<string, AgentChatMessage[]>
  pendings: Map<string, AgentChatPending>
  connected: boolean
  onCreatePlanet: (name: string, projectPath: string) => Promise<void> | void
  onDeletePlanet: (planetId: number) => Promise<void> | void
  onCreateFeature: (planetId: number, name: string, task: string) => Promise<FeatureSummary | null>
  onSend: (agentRunId: string, content: string) => void
  onClarificationReply: (agentRunId: string, toolUseId: string, answer: string) => void
  onOpenWorkflow?: () => void
  onJumpToRun?: () => void
}

/**
 * Owns the PixiJS app, the Galaxy ↔ Dock scene switch, and the small piece
 * of state shared with the HUD (selected planet, current panel tab, hover
 * tooltip, mute flag). The React HUD overlay lives in GameHud.tsx — keeping
 * the two concerns in separate files lets each be read top-to-bottom without
 * scrolling past the other.
 */
export function GameCanvas(props: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const galaxyRef = useRef<GalaxyScene | null>(null)
  const dockRef = useRef<DockScene | null>(null)
  const [ready, setReady] = useState(false)
  const [selectedPlanetId, setSelectedPlanetId] = useState<number | null>(null)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [panelTab, setPanelTab] = useState<PlanetPanelTab>('features')
  const [muted, setMutedState] = useState<boolean>(isAudioMuted())

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next)
    setAudioMuted(next)
  }, [])

  // We only need one HUD store handle here — for the drone-click callback
  // wired into the dock scene. The full HUD reads useGameHud() inside
  // GameHud.tsx, but selecting a single stable setter here avoids
  // re-running the scene-switch effect on every HUD render.
  const setOpenedDroneId = useGameHud().setOpenedDroneId

  // Bounce back to galaxy if the selected planet was removed.
  useEffect(() => {
    if (selectedPlanetId !== null && !props.planets.find((s) => s.id === selectedPlanetId)) {
      setSelectedPlanetId(null)
    }
  }, [props.planets, selectedPlanetId])

  // Play chime whenever pendings count increases.
  const prevPendingCountRef = useRef(props.pendings.size)
  useEffect(() => {
    const cur = props.pendings.size
    if (cur > prevPendingCountRef.current) playClarificationChime()
    prevPendingCountRef.current = cur
  }, [props.pendings])

  // ---- 1. Mount PixiJS app on first render. ----
  useEffect(() => {
    if (!mountRef.current) return
    let cancelled = false
    const app = new Application()
    appRef.current = app
    void app
      .init({
        background: '#020617', // slate-950
        resizeTo: mountRef.current,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      })
      .then(() => {
        if (cancelled || !mountRef.current) return
        mountRef.current.appendChild(app.canvas)
        setReady(true)
      })

    return () => {
      cancelled = true
      try {
        appRef.current?.canvas?.remove()
        appRef.current?.destroy(true, { children: true })
      } catch {
        // ignore
      }
      appRef.current = null
      galaxyRef.current = null
      dockRef.current = null
      setReady(false)
    }
  }, [])

  // ---- 2. Switch scenes when selectedPlanetId changes. ----
  useEffect(() => {
    if (!ready || !appRef.current) return
    const app = appRef.current

    // Tear down both scenes; recreate the active one.
    galaxyRef.current?.destroy()
    galaxyRef.current = null
    dockRef.current?.destroy()
    dockRef.current = null
    app.stage.removeChildren()

    if (selectedPlanetId === null) {
      const galaxy = new GalaxyScene(app, {
        onPlanetClick: (id) => {
          setTooltip(null)
          setSelectedPlanetId(id)
        },
        onPlanetHover: (id, x, y) => setTooltip({ planetId: id, x, y }),
        onPlanetHoverEnd: () => setTooltip(null),
        onBackgroundClick: () => setTooltip(null),
      })
      app.stage.addChild(galaxy.root)
      galaxyRef.current = galaxy
    } else {
      const dock = new DockScene(app, {
        onBack: () => setSelectedPlanetId(null),
        onPlanetHullClick: () => setPanelTab('chat'),
        onDroneClick: (_role, agentRunId) => setOpenedDroneId(agentRunId),
      })
      dock.setPanelWidth(COCKPIT_PANEL_WIDTH)
      app.stage.addChild(dock.root)
      dockRef.current = dock
      // Default to "features" tab whenever we enter a planet.
      setPanelTab('features')
    }
  }, [ready, selectedPlanetId, setOpenedDroneId])

  // ---- 3. Push planets into the galaxy scene whenever they change. ----
  // `ready` is in the deps because effect 2 (which creates the GalaxyScene) only
  // runs once the PixiJS app finishes its async init. Without it, switching away
  // from the canvas (e.g. to the editor) and back leaves the new scene empty —
  // props.planets hasn't changed by reference, so this effect would never re-run.
  useEffect(() => {
    if (!galaxyRef.current) return
    const moods = new Map<number, PlanetMood>()
    const anyPending = props.pendings.size > 0
    for (const planet of props.planets) {
      // Broken planets take precedence — they can't run anything anyway.
      if (!planet.pathExists) {
        moods.set(planet.id, 'broken')
        continue
      }
      const fs = props.features.get(planet.id) ?? []
      const running = fs.some((f) => f.status === 'running')
      if (running && anyPending) moods.set(planet.id, 'attention')
      else if (running) moods.set(planet.id, 'active')
      else moods.set(planet.id, 'idle')
    }
    galaxyRef.current.setPlanets(props.planets, moods)
  }, [ready, props.planets, props.features, props.pendings, selectedPlanetId])

  // ---- 4. Push current planet + drones into the dock scene. ----
  useEffect(() => {
    if (!dockRef.current || selectedPlanetId === null) return
    const planet = props.planets.find((s) => s.id === selectedPlanetId) ?? null
    dockRef.current.setPlanet(planet)

    // Show drone sessions if THIS planet has a running feature. We rely on the
    // server's single-active-feature invariant for now — any sessions that
    // exist while a running feature is on this planet belong to it.
    const planetFeatures = props.features.get(selectedPlanetId) ?? []
    const hasRunning = planetFeatures.some((f) => f.status === 'running')
    const droneSpecs: DockDroneSpec[] = hasRunning
      ? props.sessions
          .filter((s) => s.role === 'drone')
          .map((s) => ({ role: s.label ?? s.id.slice(0, 6), agentRunId: s.id }))
      : []
    dockRef.current.setDrones(droneSpecs)
  }, [ready, props.planets, props.features, props.sessions, selectedPlanetId])

  const fitGalaxy = useCallback(() => galaxyRef.current?.fitToPlanets(), [])

  return (
    <div className="flex-1 relative overflow-hidden bg-black">
      {/* Canvas mount target */}
      <div ref={mountRef} className="absolute inset-0 bg-[#020617]" />

      <GameHud
        planets={props.planets}
        features={props.features}
        sessions={props.sessions}
        transcripts={props.transcripts}
        pendings={props.pendings}
        connected={props.connected}
        onCreatePlanet={props.onCreatePlanet}
        onDeletePlanet={props.onDeletePlanet}
        onCreateFeature={props.onCreateFeature}
        onSend={props.onSend}
        onClarificationReply={props.onClarificationReply}
        onOpenWorkflow={props.onOpenWorkflow}
        onJumpToRun={props.onJumpToRun}
        selectedPlanetId={selectedPlanetId}
        setSelectedPlanetId={setSelectedPlanetId}
        panelTab={panelTab}
        setPanelTab={setPanelTab}
        tooltip={tooltip}
        muted={muted}
        setMuted={setMuted}
        onFitGalaxy={fitGalaxy}
        cockpitPanelWidth={COCKPIT_PANEL_WIDTH}
      />
    </div>
  )
}
