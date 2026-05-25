import { useCallback } from 'react'
import { useDismissable } from '../hooks/useDismissable'
import type {
  FeatureSummary,
  SessionDescriptor,
  ShipSummary,
} from '../../core/types'
import { type AgentChatMessage, type AgentChatPending } from '../components/AgentChat'
import { ShipDetailsPanel, type ShipPanelTab } from '../components/ShipDetailsPanel'
import { ToolsTabContent } from '../components/ToolsTabContent'
import { EmptyMessage } from '../components/ui/EmptyMessage'
import { ChatModal } from './ChatModal'
import { Modal } from './Modal'
import { useGameHud } from './useGameHud'

export interface Tooltip {
  shipId: number
  x: number
  y: number
}

interface Props {
  // Live data slices forwarded straight from the store.
  ships: ShipSummary[]
  features: Map<number, FeatureSummary[]>
  sessions: SessionDescriptor[]
  transcripts: Map<string, AgentChatMessage[]>
  pendings: Map<string, AgentChatPending>
  connected: boolean

  // Callbacks the HUD invokes back into App.
  onCreateShip: (name: string, projectPath: string) => Promise<void> | void
  onDeleteShip: (shipId: number) => Promise<void> | void
  onCreateFeature: (shipId: number, name: string, task: string) => Promise<FeatureSummary | null>
  onSend: (agentRunId: string, content: string) => void
  onClarificationReply: (agentRunId: string, toolUseId: string, answer: string) => void
  onOpenWorkflow?: () => void
  onJumpToRun?: () => void

  // Canvas-coupled state owned by GameCanvas — the HUD reads to render and
  // the scene callbacks write into it, so it must live one level up.
  selectedShipId: number | null
  setSelectedShipId: (id: number | null) => void
  panelTab: ShipPanelTab
  setPanelTab: (tab: ShipPanelTab) => void
  tooltip: Tooltip | null

  // HUD-bar audio toggle (chime mute flag).
  muted: boolean
  setMuted: (muted: boolean) => void

  // Galaxy-only HUD action that requires reaching into the Pixi scene.
  onFitGalaxy: () => void

  // How wide the right-side dock cockpit panel is (also drives PixiJS centring).
  cockpitPanelWidth: number
}

/**
 * React HUD overlaid on top of the PixiJS canvas. Owns the top bar, the
 * notifications inbox, the dock cockpit panel, the hover tooltip, and the
 * modals (new ship / new feature / drone chat / global library / first-launch
 * splash). Doesn't touch PixiJS — the scenes live in GameCanvas.
 */
export function GameHud(props: Props) {
  const hud = useGameHud()

  const closeLibrary = useCallback(() => hud.setLibraryOpen(false), [hud])
  useDismissable(hud.libraryOpen, closeLibrary)

  const submitNewShip = useCallback(async () => {
    if (!hud.shipName.trim() || !hud.shipPath.trim()) return
    await props.onCreateShip(hud.shipName.trim(), hud.shipPath.trim())
    hud.closeNewShip()
  }, [props, hud])

  const submitNewFeature = useCallback(async () => {
    if (!props.selectedShipId || !hud.featureTask.trim()) return
    const f = await props.onCreateFeature(
      props.selectedShipId,
      hud.featureName.trim() || `feature-${Date.now()}`,
      hud.featureTask.trim(),
    )
    if (f) {
      hud.closeNewFeature()
      props.onJumpToRun?.()
    }
  }, [props, hud])

  const selectedShip =
    props.selectedShipId !== null
      ? props.ships.find((s) => s.id === props.selectedShipId) ?? null
      : null
  const selectedShipFeatures =
    props.selectedShipId !== null ? props.features.get(props.selectedShipId) ?? [] : []
  const hoveredShip = props.tooltip
    ? props.ships.find((s) => s.id === props.tooltip!.shipId) ?? null
    : null
  const hoveredShipFeatures = hoveredShip ? props.features.get(hoveredShip.id) ?? [] : []
  const totalPendingClarifications = props.pendings.size

  return (
    <>
      {/* HUD top bar */}
      <div className="absolute top-3 left-3 right-3 flex items-start justify-between pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 text-xs">
          {props.selectedShipId !== null ? (
            <>
              <button
                onClick={() => props.setSelectedShipId(null)}
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
                onClick={() => hud.setNewShipOpen(true)}
                className="px-3 py-1 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black tracking-wide bg-black/70"
              >
                + new ship
              </button>
              <button
                onClick={props.onFitGalaxy}
                disabled={props.ships.length === 0}
                className="px-3 py-1 border border-zinc-500 text-zinc-300 hover:bg-zinc-700 tracking-wide bg-black/70 disabled:opacity-30"
              >
                ⛶ fit
              </button>
              <button
                onClick={() => hud.setLibraryOpen(true)}
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
              onClick={() => hud.setInboxOpen(!hud.inboxOpen)}
              className={`${
                totalPendingClarifications > 0 ? 'text-amber-300' : 'text-zinc-500'
              } hover:text-amber-200 ${totalPendingClarifications > 0 ? 'animate-pulse' : ''}`}
            >
              {totalPendingClarifications} pending
            </button>
          </div>
          <button
            onClick={() => props.setMuted(!props.muted)}
            title={props.muted ? 'unmute clarification chime' : 'mute clarification chime'}
            className="bg-black/70 border border-cyan-500/30 px-2 py-1 text-zinc-300 hover:text-cyan-200"
          >
            {props.muted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>

      {/* Notifications inbox popover */}
      {hud.inboxOpen && (
        <div
          className="absolute right-3 top-12 w-80 bg-black/95 border border-amber-400/40 z-10 pointer-events-auto text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-amber-400/30 px-3 py-2 flex items-center justify-between">
            <span className="text-amber-300 tracking-widest text-[10px]">INBOX</span>
            <button onClick={() => hud.setInboxOpen(false)} className="text-zinc-500 hover:text-zinc-300">
              ×
            </button>
          </div>
          {props.pendings.size === 0 ? (
            <EmptyMessage className="px-3 py-3">no pending transmissions.</EmptyMessage>
          ) : (
            <ul>
              {Array.from(props.pendings.entries()).map(([agentRunId, p]) => {
                const session = props.sessions.find((s) => s.id === agentRunId)
                return (
                  <li
                    key={agentRunId}
                    className="px-3 py-2 border-b border-amber-400/10 hover:bg-amber-500/5 cursor-pointer"
                    onClick={() => {
                      hud.setInboxOpen(false)
                      // Heuristic: if a drone is awaiting input, the ship is
                      // the one with a running feature.
                      const runningShip = props.ships.find(
                        (s) => (props.features.get(s.id) ?? []).some((f) => f.status === 'running'),
                      )
                      if (runningShip) props.setSelectedShipId(runningShip.id)
                      hud.setOpenedDroneId(agentRunId)
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
      {props.selectedShipId !== null && selectedShip && (
        <aside
          className="absolute right-0 top-0 bottom-0 bg-black/85 border-l border-cyan-500/30 pointer-events-auto"
          style={{ width: props.cockpitPanelWidth }}
        >
          <ShipDetailsPanel
            ship={selectedShip}
            features={selectedShipFeatures}
            sessions={props.sessions}
            transcripts={props.transcripts}
            pendings={props.pendings}
            connected={props.connected}
            tab={props.panelTab}
            onTabChange={props.setPanelTab}
            onSend={props.onSend}
            onClarificationReply={props.onClarificationReply}
            onNewFeature={() => hud.setNewFeatureOpen(true)}
            onOpenWorkflow={() => props.onOpenWorkflow?.()}
            onDeleteShip={() => {
              if (props.selectedShipId !== null) {
                void props.onDeleteShip(props.selectedShipId)
                // Optimistically pop back to galaxy; the ship:deleted event
                // will also do it below — this is a faster UI response.
                props.setSelectedShipId(null)
              }
            }}
          />
        </aside>
      )}

      {/* Hover tooltip in galaxy view */}
      {props.tooltip && hoveredShip && (
        <div
          className={`absolute pointer-events-none bg-black/90 border text-xs px-3 py-2 z-10 ${
            hoveredShip.pathExists ? 'border-cyan-500/50' : 'border-rose-500/60'
          }`}
          style={{
            left: Math.min(props.tooltip.x + 16, window.innerWidth - 240),
            top: Math.min(props.tooltip.y + 16, window.innerHeight - 100),
          }}
        >
          <div
            className={
              hoveredShip.pathExists
                ? 'text-cyan-300 tracking-widest'
                : 'text-rose-300 tracking-widest'
            }
          >
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
      {hud.newShipOpen && (
        <Modal title="NEW SHIP" onClose={hud.closeNewShip} onSubmit={submitNewShip}>
          <label className="text-[10px] tracking-widest text-zinc-500">SHIP NAME</label>
          <input
            value={hud.shipName}
            onChange={(e) => hud.setShipName(e.target.value)}
            autoFocus
            className="w-full mt-1 mb-3 bg-black border border-cyan-500/40 rounded px-2 py-1"
          />
          <label className="text-[10px] tracking-widest text-zinc-500">PROJECT PATH</label>
          <input
            value={hud.shipPath}
            onChange={(e) => hud.setShipPath(e.target.value)}
            placeholder="C:/code/my-repo (must be a git repository)"
            className="w-full mt-1 bg-black border border-cyan-500/40 rounded px-2 py-1 font-mono text-xs"
          />
        </Modal>
      )}

      {hud.openedDroneId && (
        <ChatModal
          title={`DRONE / ${props.sessions.find((s) => s.id === hud.openedDroneId)?.label ?? hud.openedDroneId.slice(0, 8)}`}
          agentRunId={hud.openedDroneId}
          session={props.sessions.find((s) => s.id === hud.openedDroneId) ?? null}
          transcript={props.transcripts.get(hud.openedDroneId) ?? []}
          pending={props.pendings.get(hud.openedDroneId) ?? null}
          connected={props.connected}
          onSend={(content) => props.onSend(hud.openedDroneId!, content)}
          onReply={(toolUseId, answer) =>
            props.onClarificationReply(hud.openedDroneId!, toolUseId, answer)
          }
          onClose={() => hud.setOpenedDroneId(null)}
        />
      )}

      {hud.libraryOpen && props.selectedShipId === null && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-30"
          onClick={() => hud.setLibraryOpen(false)}
        >
          <div
            className="bg-black border border-emerald-500/60 rounded w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-emerald-500/40 px-4 py-2 flex items-center justify-between">
              <h2 className="text-emerald-300 tracking-widest">GLOBAL TOOL LIBRARY</h2>
              <button
                onClick={() => hud.setLibraryOpen(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
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
      {props.ships.length === 0 && props.selectedShipId === null && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/80 border border-cyan-500/40 px-8 py-6 text-center pointer-events-auto max-w-md">
            <div className="text-cyan-300 tracking-[0.3em] text-xs mb-3">WELCOME, CAPTAIN</div>
            <p className="text-zinc-300 mb-4">
              The shipyard is quiet. Register your first ship to begin — point it at a git repo on
              your machine and the drones will report for duty.
            </p>
            <button
              onClick={() => hud.setNewShipOpen(true)}
              className="px-4 py-2 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black tracking-wide text-xs"
            >
              + register first ship
            </button>
          </div>
        </div>
      )}

      {hud.newFeatureOpen && selectedShip && (
        <Modal
          title={`NEW FEATURE — ${selectedShip.name}`}
          onClose={hud.closeNewFeature}
          onSubmit={submitNewFeature}
        >
          <label className="text-[10px] tracking-widest text-zinc-500">FEATURE NAME (optional)</label>
          <input
            value={hud.featureName}
            onChange={(e) => hud.setFeatureName(e.target.value)}
            placeholder="auto-generated if blank"
            className="w-full mt-1 mb-3 bg-black border border-cyan-500/40 rounded px-2 py-1"
          />
          <label className="text-[10px] tracking-widest text-zinc-500">TASK</label>
          <textarea
            value={hud.featureTask}
            onChange={(e) => hud.setFeatureTask(e.target.value)}
            autoFocus
            rows={6}
            placeholder="What should the workflow accomplish?"
            className="w-full mt-1 bg-black border border-cyan-500/40 rounded p-2 text-xs font-mono"
          />
          <p className="text-[10px] text-zinc-500 mt-2">
            A worktree will be created under{' '}
            <code className="text-cyan-300">.agentyard/worktrees/</code> on a fresh branch off the
            current HEAD.
          </p>
        </Modal>
      )}
    </>
  )
}
