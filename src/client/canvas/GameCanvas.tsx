import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Application } from 'pixi.js'
import type {
  FeatureSummary,
  SessionDescriptor,
  ShipSummary,
} from '../../core/types'
import { GalaxyScene, type ShipMood } from './galaxyScene'
import { DockScene, type DockDroneSpec } from './dockScene'
import { AgentChat, type AgentChatMessage, type AgentChatPending } from '../components/AgentChat'
import { ShipDetailsPanel, type ShipPanelTab } from '../components/ShipDetailsPanel'
import { ToolsTabContent } from '../components/ToolsTabContent'
import { isAudioMuted, playClarificationChime, setAudioMuted } from './chime'

const COCKPIT_PANEL_WIDTH = 480

interface Props {
  ships: ShipSummary[]
  features: Map<number, FeatureSummary[]>
  sessions: SessionDescriptor[]
  transcripts: Map<string, AgentChatMessage[]>
  pendings: Map<string, AgentChatPending>
  connected: boolean
  onCreateShip: (name: string, projectPath: string) => Promise<void> | void
  onDeleteShip: (shipId: number) => Promise<void> | void
  onCreateFeature: (shipId: number, name: string, task: string) => Promise<FeatureSummary | null>
  onSend: (agentRunId: string, content: string) => void
  onClarificationReply: (agentRunId: string, toolUseId: string, answer: string) => void
  onOpenWorkflow?: () => void
  onJumpToRun?: () => void
}

interface Tooltip {
  shipId: number
  x: number
  y: number
}

export function GameCanvas(props: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const galaxyRef = useRef<GalaxyScene | null>(null)
  const dockRef = useRef<DockScene | null>(null)
  const [ready, setReady] = useState(false)
  const [selectedShipId, setSelectedShipId] = useState<number | null>(null)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [newShipOpen, setNewShipOpen] = useState(false)
  const [newFeatureOpen, setNewFeatureOpen] = useState(false)
  const [openedDroneId, setOpenedDroneId] = useState<string | null>(null)
  const [panelTab, setPanelTab] = useState<ShipPanelTab>('features')
  const [inboxOpen, setInboxOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [muted, setMuted] = useState<boolean>(isAudioMuted())
  const [shipName, setShipName] = useState('')
  const [shipPath, setShipPath] = useState('')
  const [featureName, setFeatureName] = useState('')
  const [featureTask, setFeatureTask] = useState('')

  // Esc closes the library overlay.
  useEffect(() => {
    if (!libraryOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLibraryOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [libraryOpen])

  // Bounce back to galaxy if the selected ship was removed.
  useEffect(() => {
    if (selectedShipId !== null && !props.ships.find((s) => s.id === selectedShipId)) {
      setSelectedShipId(null)
    }
  }, [props.ships, selectedShipId])

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

  // ---- 2. Switch scenes when selectedShipId changes. ----
  useEffect(() => {
    if (!ready || !appRef.current) return
    const app = appRef.current

    // Tear down both scenes; recreate the active one.
    galaxyRef.current?.destroy()
    galaxyRef.current = null
    dockRef.current?.destroy()
    dockRef.current = null
    app.stage.removeChildren()

    if (selectedShipId === null) {
      const galaxy = new GalaxyScene(app, {
        onShipClick: (id) => {
          setTooltip(null)
          setSelectedShipId(id)
        },
        onShipHover: (id, x, y) => setTooltip({ shipId: id, x, y }),
        onShipHoverEnd: () => setTooltip(null),
        onBackgroundClick: () => setTooltip(null),
      })
      app.stage.addChild(galaxy.root)
      galaxyRef.current = galaxy
    } else {
      const dock = new DockScene(app, {
        onBack: () => setSelectedShipId(null),
        onShipHullClick: () => setPanelTab('chat'),
        onDroneClick: (_role, agentRunId) => setOpenedDroneId(agentRunId),
      })
      dock.setPanelWidth(COCKPIT_PANEL_WIDTH)
      app.stage.addChild(dock.root)
      dockRef.current = dock
      // Default to "features" tab whenever we enter a ship.
      setPanelTab('features')
    }
  }, [ready, selectedShipId])

  // ---- 3. Push ships into the galaxy scene whenever they change. ----
  useEffect(() => {
    if (!galaxyRef.current) return
    const moods = new Map<number, ShipMood>()
    const anyPending = props.pendings.size > 0
    for (const ship of props.ships) {
      // Broken ships take precedence — they can't run anything anyway.
      if (!ship.pathExists) {
        moods.set(ship.id, 'broken')
        continue
      }
      const fs = props.features.get(ship.id) ?? []
      const running = fs.some((f) => f.status === 'running')
      if (running && anyPending) moods.set(ship.id, 'attention')
      else if (running) moods.set(ship.id, 'active')
      else moods.set(ship.id, 'idle')
    }
    galaxyRef.current.setShips(props.ships, moods)
  }, [props.ships, props.features, props.pendings, selectedShipId])

  // ---- 4. Push current ship + drones into the dock scene. ----
  useEffect(() => {
    if (!dockRef.current || selectedShipId === null) return
    const ship = props.ships.find((s) => s.id === selectedShipId) ?? null
    dockRef.current.setShip(ship)

    // Show drone sessions if THIS ship has a running feature. We rely on the
    // server's single-active-feature invariant for now — any sessions that
    // exist while a running feature is on this ship belong to it.
    const shipFeatures = props.features.get(selectedShipId) ?? []
    const hasRunning = shipFeatures.some((f) => f.status === 'running')
    const droneSpecs: DockDroneSpec[] = hasRunning
      ? props.sessions
          .filter((s) => s.role === 'drone')
          .map((s) => ({ role: s.label ?? s.id.slice(0, 6), agentRunId: s.id }))
      : []
    dockRef.current.setDrones(droneSpecs)
  }, [props.ships, props.features, props.sessions, selectedShipId])

  // ---- HUD actions ----
  const submitNewShip = useCallback(async () => {
    if (!shipName.trim() || !shipPath.trim()) return
    await props.onCreateShip(shipName.trim(), shipPath.trim())
    setNewShipOpen(false)
    setShipName('')
    setShipPath('')
  }, [props, shipName, shipPath])

  const submitNewFeature = useCallback(async () => {
    if (!selectedShipId || !featureTask.trim()) return
    const f = await props.onCreateFeature(
      selectedShipId,
      featureName.trim() || `feature-${Date.now()}`,
      featureTask.trim(),
    )
    if (f) {
      setNewFeatureOpen(false)
      setFeatureName('')
      setFeatureTask('')
      props.onJumpToRun?.()
    }
  }, [props, selectedShipId, featureName, featureTask])

  // ---- Derived view bits for HUD ----
  const selectedShip = useMemo(
    () => (selectedShipId ? props.ships.find((s) => s.id === selectedShipId) ?? null : null),
    [props.ships, selectedShipId],
  )
  const selectedShipFeatures = useMemo(
    () => (selectedShipId ? props.features.get(selectedShipId) ?? [] : []),
    [props.features, selectedShipId],
  )
  const hoveredShip = useMemo(
    () => (tooltip ? props.ships.find((s) => s.id === tooltip.shipId) ?? null : null),
    [props.ships, tooltip],
  )
  const hoveredShipFeatures = hoveredShip ? props.features.get(hoveredShip.id) ?? [] : []
  const totalPendingClarifications = props.pendings.size

  return (
    <div className="flex-1 relative overflow-hidden">
      {/* Canvas mount target */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* HUD top bar */}
      <div className="absolute top-3 left-3 right-3 flex items-start justify-between pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 text-xs">
          {selectedShipId !== null ? (
            <>
              <button
                onClick={() => setSelectedShipId(null)}
                className="px-3 py-1 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black tracking-wide bg-black/70"
              >
                ← galaxy
              </button>
              {selectedShip && (
                <div className="bg-black/70 border border-cyan-500/40 px-3 py-1 text-cyan-200 tracking-wider">
                  {selectedShip.name}
                </div>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => setNewShipOpen(true)}
                className="px-3 py-1 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black tracking-wide bg-black/70"
              >
                + new ship
              </button>
              <button
                onClick={() => galaxyRef.current?.fitToShips()}
                disabled={props.ships.length === 0}
                className="px-3 py-1 border border-zinc-500 text-zinc-300 hover:bg-zinc-700 tracking-wide bg-black/70 disabled:opacity-30"
              >
                ⛶ fit
              </button>
              <button
                onClick={() => setLibraryOpen(true)}
                className="px-3 py-1 border border-emerald-500 text-emerald-300 hover:bg-emerald-500 hover:text-black tracking-wide bg-black/70"
                title="global tool library"
              >
                library
              </button>
            </>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-2 text-xs">
          <div className="bg-black/70 border border-cyan-500/30 px-3 py-1 flex items-center gap-3">
            <span className="text-cyan-200">
              {props.ships.length} ship{props.ships.length === 1 ? '' : 's'}
            </span>
            <span className="text-zinc-700">·</span>
            <button
              onClick={() => setInboxOpen((v) => !v)}
              className={`${
                totalPendingClarifications > 0 ? 'text-amber-300' : 'text-zinc-500'
              } hover:text-amber-200 ${totalPendingClarifications > 0 ? 'animate-pulse' : ''}`}
            >
              {totalPendingClarifications} pending
            </button>
          </div>
          <button
            onClick={() => {
              const next = !muted
              setMuted(next)
              setAudioMuted(next)
            }}
            title={muted ? 'unmute clarification chime' : 'mute clarification chime'}
            className="bg-black/70 border border-cyan-500/30 px-2 py-1 text-zinc-300 hover:text-cyan-200"
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>

      {/* Notifications inbox popover */}
      {inboxOpen && (
        <div
          className="absolute right-3 top-12 w-80 bg-black/95 border border-amber-400/40 z-10 pointer-events-auto text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-amber-400/30 px-3 py-2 flex items-center justify-between">
            <span className="text-amber-300 tracking-widest text-[10px]">INBOX</span>
            <button onClick={() => setInboxOpen(false)} className="text-zinc-500 hover:text-zinc-300">
              ×
            </button>
          </div>
          {props.pendings.size === 0 ? (
            <p className="px-3 py-3 text-zinc-600 italic">// no pending transmissions.</p>
          ) : (
            <ul>
              {Array.from(props.pendings.entries()).map(([agentRunId, p]) => {
                const session = props.sessions.find((s) => s.id === agentRunId)
                return (
                  <li
                    key={agentRunId}
                    className="px-3 py-2 border-b border-amber-400/10 hover:bg-amber-500/5 cursor-pointer"
                    onClick={() => {
                      setInboxOpen(false)
                      // Make sure the parent ship is open in dock view.
                      // Heuristic: if a drone is awaiting input, the ship is the one with a running feature.
                      const runningShip = props.ships.find(
                        (s) => (props.features.get(s.id) ?? []).some((f) => f.status === 'running'),
                      )
                      if (runningShip) setSelectedShipId(runningShip.id)
                      setOpenedDroneId(agentRunId)
                    }}
                  >
                    <div className="text-cyan-300">{session?.label ?? agentRunId.slice(0, 8)}</div>
                    <p className="text-zinc-300 mt-0.5 line-clamp-2">{p.question}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Dock view: always-visible cockpit panel on the right */}
      {selectedShipId !== null && selectedShip && (
        <aside
          className="absolute right-0 top-0 bottom-0 bg-black/85 border-l border-cyan-500/30 pointer-events-auto"
          style={{ width: COCKPIT_PANEL_WIDTH }}
        >
          <ShipDetailsPanel
            ship={selectedShip}
            features={selectedShipFeatures}
            sessions={props.sessions}
            transcripts={props.transcripts}
            pendings={props.pendings}
            connected={props.connected}
            tab={panelTab}
            onTabChange={setPanelTab}
            onSend={props.onSend}
            onClarificationReply={props.onClarificationReply}
            onNewFeature={() => setNewFeatureOpen(true)}
            onOpenWorkflow={() => props.onOpenWorkflow?.()}
            onDeleteShip={() => {
              if (selectedShipId !== null) {
                void props.onDeleteShip(selectedShipId)
                // Optimistically pop back to galaxy; the ship:deleted event
                // will also do it below, this is just a faster UI response.
                setSelectedShipId(null)
              }
            }}
          />
        </aside>
      )}

      {/* Hover tooltip in galaxy view */}
      {tooltip && hoveredShip && (
        <div
          className={`absolute pointer-events-none bg-black/90 border text-xs px-3 py-2 z-10 ${
            hoveredShip.pathExists ? 'border-cyan-500/50' : 'border-rose-500/60'
          }`}
          style={{
            left: Math.min(tooltip.x + 16, window.innerWidth - 240),
            top: Math.min(tooltip.y + 16, window.innerHeight - 100),
          }}
        >
          <div className={hoveredShip.pathExists ? 'text-cyan-300 tracking-widest' : 'text-rose-300 tracking-widest'}>
            {hoveredShip.name.toUpperCase()}
          </div>
          <div className="text-zinc-400 font-mono text-[10px] mt-0.5 max-w-[220px] truncate">
            {hoveredShip.projectPath}
          </div>
          {!hoveredShip.pathExists ? (
            <div className="mt-2 text-rose-300 text-[11px] tracking-wide">⚠ path missing</div>
          ) : (
            <div className="mt-2 text-zinc-300 text-[11px]">
              features: {hoveredShipFeatures.length}
              {hoveredShipFeatures.find((f) => f.status === 'running') && (
                <span className="text-cyan-300 ml-2">● active</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {newShipOpen && (
        <Modal title="NEW SHIP" onClose={() => setNewShipOpen(false)} onSubmit={submitNewShip}>
          <label className="text-[10px] tracking-widest text-zinc-500">SHIP NAME</label>
          <input
            value={shipName}
            onChange={(e) => setShipName(e.target.value)}
            autoFocus
            className="w-full mt-1 mb-3 bg-black border border-cyan-500/40 rounded px-2 py-1"
          />
          <label className="text-[10px] tracking-widest text-zinc-500">PROJECT PATH</label>
          <input
            value={shipPath}
            onChange={(e) => setShipPath(e.target.value)}
            placeholder="C:/code/my-repo (must be a git repository)"
            className="w-full mt-1 bg-black border border-cyan-500/40 rounded px-2 py-1 font-mono text-xs"
          />
        </Modal>
      )}

      {/* DroneModal — click a drone → chat with it */}
      {openedDroneId && (
        <ChatModal
          title={`DRONE / ${props.sessions.find((s) => s.id === openedDroneId)?.label ?? openedDroneId.slice(0, 8)}`}
          agentRunId={openedDroneId}
          session={props.sessions.find((s) => s.id === openedDroneId) ?? null}
          transcript={props.transcripts.get(openedDroneId) ?? []}
          pending={props.pendings.get(openedDroneId) ?? null}
          connected={props.connected}
          onSend={(content) => props.onSend(openedDroneId, content)}
          onReply={(toolUseId, answer) => props.onClarificationReply(openedDroneId, toolUseId, answer)}
          onClose={() => setOpenedDroneId(null)}
        />
      )}

      {/* Galaxy global library overlay — Esc or backdrop click closes. */}
      {libraryOpen && selectedShipId === null && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-30"
          onClick={() => setLibraryOpen(false)}
        >
          <div
            className="bg-black border border-emerald-500/60 rounded w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-emerald-500/40 px-4 py-2 flex items-center justify-between">
              <h2 className="text-emerald-300 tracking-widest">GLOBAL TOOL LIBRARY</h2>
              <button onClick={() => setLibraryOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <ToolsTabContent shipId={null} />
            </div>
          </div>
        </div>
      )}

      {/* First-launch empty state */}
      {props.ships.length === 0 && selectedShipId === null && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/80 border border-cyan-500/40 px-8 py-6 text-center pointer-events-auto max-w-md">
            <div className="text-cyan-300 tracking-[0.3em] text-xs mb-3">WELCOME, CAPTAIN</div>
            <p className="text-zinc-300 mb-4">
              The shipyard is quiet. Register your first ship to begin — point it at a git repo on your machine and the drones will report for duty.
            </p>
            <button
              onClick={() => setNewShipOpen(true)}
              className="px-4 py-2 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black tracking-wide text-xs"
            >
              + register first ship
            </button>
          </div>
        </div>
      )}

      {newFeatureOpen && selectedShip && (
        <Modal
          title={`NEW FEATURE — ${selectedShip.name}`}
          onClose={() => setNewFeatureOpen(false)}
          onSubmit={submitNewFeature}
        >
          <label className="text-[10px] tracking-widest text-zinc-500">FEATURE NAME (optional)</label>
          <input
            value={featureName}
            onChange={(e) => setFeatureName(e.target.value)}
            placeholder="auto-generated if blank"
            className="w-full mt-1 mb-3 bg-black border border-cyan-500/40 rounded px-2 py-1"
          />
          <label className="text-[10px] tracking-widest text-zinc-500">TASK</label>
          <textarea
            value={featureTask}
            onChange={(e) => setFeatureTask(e.target.value)}
            autoFocus
            rows={6}
            placeholder="What should the workflow accomplish?"
            className="w-full mt-1 bg-black border border-cyan-500/40 rounded p-2 text-xs font-mono"
          />
          <p className="text-[10px] text-zinc-500 mt-2">
            A worktree will be created under{' '}
            <code className="text-cyan-300">.agentyard/worktrees/</code> on a fresh branch off the current HEAD.
          </p>
        </Modal>
      )}
    </div>
  )
}

function Modal({
  title,
  children,
  onClose,
  onSubmit,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
  onSubmit: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-20">
      <div className="bg-black border border-cyan-500/60 rounded p-6 max-w-xl w-full text-sm">
        <h2 className="text-cyan-300 tracking-widest text-sm mb-4">{title}</h2>
        {children}
        <div className="flex gap-2 mt-4 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1 border border-zinc-500 text-zinc-400 hover:bg-zinc-700 text-xs tracking-wide"
          >
            cancel
          </button>
          <button
            onClick={onSubmit}
            className="px-4 py-1 border border-fuchsia-500 text-fuchsia-300 hover:bg-fuchsia-500 hover:text-black text-xs tracking-wide"
          >
            launch
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatModal({
  title,
  agentRunId,
  session,
  transcript,
  pending,
  connected,
  onSend,
  onReply,
  onClose,
}: {
  title: string
  agentRunId: string
  session: SessionDescriptor | null
  transcript: AgentChatMessage[]
  pending: AgentChatPending | null
  connected: boolean
  onSend: (content: string) => void
  onReply: (toolUseId: string, answer: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-20">
      <div className="bg-black border border-cyan-500/60 rounded w-full max-w-2xl h-[70vh] flex flex-col">
        <div className="border-b border-cyan-500/40 px-4 py-2 flex items-center justify-between">
          <h2 className="text-cyan-300 tracking-widest text-xs">{title}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">
            ×
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <AgentChat
            agentRunId={agentRunId}
            label={session?.label}
            role={session?.role}
            state={session?.state}
            transcript={transcript}
            pending={pending}
            connected={connected}
            onSend={onSend}
            onReply={onReply}
          />
        </div>
      </div>
    </div>
  )
}
