import { useEffect, useMemo, useState } from 'react'
import type { FeatureSummary, ShipSummary } from '../../core/types'
import { useDismissable } from '../hooks/useDismissable'

interface Props {
  ships: ShipSummary[]
  features: Map<number, FeatureSummary[]>
  onCreateShip: (name: string, projectPath: string) => Promise<void> | void
  onDeleteShip: (id: number) => Promise<void> | void
  onCreateFeature: (shipId: number, name: string, task: string) => Promise<FeatureSummary | null>
  onSelectFeature?: (feature: FeatureSummary) => void
  /** When a feature is created, parent may want to switch to the run view. */
  onJumpToRun?: () => void
}

const STATUS_COLORS: Record<FeatureSummary['status'], string> = {
  pending: 'text-zinc-400',
  running: 'text-cyan-300',
  complete: 'text-emerald-300',
  failed: 'text-rose-400',
}

export function ShipsView({
  ships,
  features,
  onCreateShip,
  onDeleteShip,
  onCreateFeature,
  onSelectFeature,
  onJumpToRun,
}: Props) {
  const [selectedShipId, setSelectedShipId] = useState<number | null>(null)
  const [newShipOpen, setNewShipOpen] = useState(false)
  const [newFeatureOpen, setNewFeatureOpen] = useState(false)
  const [shipName, setShipName] = useState('')
  const [shipPath, setShipPath] = useState('')
  const [featureName, setFeatureName] = useState('')
  const [featureTask, setFeatureTask] = useState('')

  useEffect(() => {
    if (!selectedShipId && ships.length > 0) setSelectedShipId(ships[0]!.id)
  }, [ships, selectedShipId])

  const selectedShip = ships.find((s) => s.id === selectedShipId)
  const shipFeatures = useMemo(
    () => (selectedShipId ? features.get(selectedShipId) ?? [] : []),
    [features, selectedShipId],
  )

  async function submitShip() {
    if (!shipName.trim() || !shipPath.trim()) return
    await onCreateShip(shipName.trim(), shipPath.trim())
    setNewShipOpen(false)
    setShipName('')
    setShipPath('')
  }

  async function submitFeature() {
    if (!selectedShipId || !featureTask.trim()) return
    const f = await onCreateFeature(
      selectedShipId,
      featureName.trim() || `feature-${Date.now()}`,
      featureTask.trim(),
    )
    if (f) {
      setNewFeatureOpen(false)
      setFeatureName('')
      setFeatureTask('')
      onJumpToRun?.()
    }
  }

  return (
    <div className="flex-1 flex text-sm">
      <aside className="w-64 border-r border-cyan-500/30 p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-cyan-300 tracking-widest text-xs">SHIPS</h2>
          <button
            onClick={() => setNewShipOpen(true)}
            className="px-2 py-0.5 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black text-[10px]"
          >
            + new
          </button>
        </div>
        {ships.length === 0 ? (
          <p className="text-zinc-600 italic text-xs">// no ships yet</p>
        ) : (
          <ul className="space-y-1">
            {ships.map((s) => {
              const sel = s.id === selectedShipId
              return (
                <li key={s.id}>
                  <button
                    onClick={() => setSelectedShipId(s.id)}
                    className={`w-full text-left px-2 py-1 rounded text-xs ${
                      sel ? 'bg-cyan-500/10 text-cyan-200' : 'text-zinc-400 hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className="truncate">{s.name}</div>
                    <div className="text-[10px] text-zinc-600 truncate">{s.projectPath}</div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>

      <main className="flex-1 p-4 overflow-y-auto">
        {selectedShip ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-cyan-300 tracking-widest text-sm">{selectedShip.name}</h2>
                <p className="text-[10px] text-zinc-500 font-mono">{selectedShip.projectPath}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setNewFeatureOpen(true)}
                  className="px-3 py-1 border border-fuchsia-500 text-fuchsia-300 hover:bg-fuchsia-500 hover:text-black text-xs tracking-wide"
                >
                  ▶ new feature
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete ship "${selectedShip.name}"? This removes feature records (worktrees are not deleted from disk).`)) {
                      onDeleteShip(selectedShip.id)
                      setSelectedShipId(null)
                    }
                  }}
                  className="px-2 py-1 border border-rose-500/60 text-rose-300 hover:bg-rose-500/20 text-[10px]"
                >
                  delete ship
                </button>
              </div>
            </div>

            {shipFeatures.length === 0 ? (
              <p className="text-zinc-600 italic">// no features yet. click <span className="text-fuchsia-300">new feature</span> to start one.</p>
            ) : (
              <ul className="space-y-2">
                {shipFeatures.map((f) => (
                  <li
                    key={f.id}
                    className="border border-cyan-500/30 rounded p-3 hover:bg-cyan-500/5 cursor-pointer"
                    onClick={() => onSelectFeature?.(f)}
                  >
                    <div className="flex items-baseline justify-between">
                      <div>
                        <span className="text-cyan-300">{f.name}</span>
                        <span className={`ml-3 text-[10px] tracking-widest ${STATUS_COLORS[f.status]}`}>
                          {f.status.toUpperCase()}
                        </span>
                      </div>
                      <span className="text-[10px] text-zinc-600">
                        {new Date(f.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-zinc-300 mt-1 text-xs whitespace-pre-wrap">{f.task}</p>
                    {f.branch && (
                      <p className="text-[10px] text-zinc-500 mt-1 font-mono">
                        branch: {f.branch}
                        {f.worktreePath && <span className="ml-3">worktree: {f.worktreePath}</span>}
                      </p>
                    )}
                    {f.finalSummary && (
                      <p className="text-emerald-300/70 text-[11px] mt-2 whitespace-pre-wrap">
                        ✓ {f.finalSummary}
                      </p>
                    )}
                    {f.error && (
                      <p className="text-rose-400 text-[11px] mt-2 whitespace-pre-wrap">
                        ✗ {f.error}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-zinc-600 italic">// select a ship to view features</p>
        )}
      </main>

      {newShipOpen && (
        <Modal title="NEW SHIP" onClose={() => setNewShipOpen(false)} onSubmit={submitShip}>
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

      {newFeatureOpen && selectedShip && (
        <Modal title={`NEW FEATURE — ${selectedShip.name}`} onClose={() => setNewFeatureOpen(false)} onSubmit={submitFeature}>
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
            A git worktree will be created at <code className="text-cyan-300">{selectedShip.projectPath}/.agentyard/worktrees/&lt;id&gt;</code>
            on a fresh branch off the current HEAD.
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
  useDismissable(true, onClose)
  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-20"
      onClick={onClose}
    >
      <div
        className="bg-black border border-cyan-500/60 rounded p-6 max-w-xl w-full text-sm"
        onClick={(e) => e.stopPropagation()}
      >
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
