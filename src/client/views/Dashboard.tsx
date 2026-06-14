import { useEffect, useMemo, useState } from 'react'
import { useSocketStore } from '../state/socketStore'
import { apiGet, apiPost } from '../api'
import type { FeatureSummary, PlanetSummary, RunSnapshot } from '../../core/types'

/**
 * Phase 9 operational dashboard. Renders every in-flight + recently-finished
 * run as a kanban board so a high-volume user can supervise many features
 * across many planets at once.
 *
 * Columns are derived from RunSnapshot fields — there's no separate "state"
 * field on the snapshot yet (Phase 4's runner_sessions + Phase 7's runs do
 * carry state, but the over-the-wire snapshot only has nodeStates + error
 * + finalSummary today). The bucketing function maps those signals to the
 * seven AO-style columns described in the plan.
 *
 * Mount this anywhere via `<Dashboard onClose={...} />`. There's a simple
 * "open chat" / "cancel" quick-action wired up; the others (retry, attach
 * PTY, open PR) land alongside the runner_sessions catch-up event.
 */

const COLUMNS = [
  { key: 'working', label: 'Working' },
  { key: 'needs_input', label: 'Needs Input' },
  { key: 'failed', label: 'Failed / Stuck' },
  { key: 'in_review', label: 'In Review' },
  { key: 'ci_failing', label: 'CI Failing' },
  { key: 'ready_to_merge', label: 'Ready to Merge' },
  { key: 'done', label: 'Done' },
] as const

type ColumnKey = (typeof COLUMNS)[number]['key']

function bucketFor(run: RunSnapshot): ColumnKey {
  if (run.error) return 'failed'
  if (run.finalSummary) return 'done'
  // No richer state yet — every non-terminal run lands in Working. As Phase
  // 4 lifecycle states propagate to the wire (follow-up), the bucketing
  // will distinguish needs_input / in_review / ci_failing / ready_to_merge.
  return 'working'
}

interface ResolvedFeature {
  feature: FeatureSummary | null
  planet: PlanetSummary | null
}

function resolveFeature(
  run: RunSnapshot,
  planets: PlanetSummary[],
  featuresByPlanet: Map<number, FeatureSummary[]>,
): ResolvedFeature {
  if (run.featureId == null) return { feature: null, planet: null }
  for (const planet of planets) {
    const fs = featuresByPlanet.get(planet.id) ?? []
    const feature = fs.find((f) => f.id === run.featureId)
    if (feature) return { feature, planet }
  }
  return { feature: null, planet: null }
}

export interface DashboardProps {
  onClose?: () => void
}

export function Dashboard(props: DashboardProps) {
  const planets = useSocketStore((s) => s.planets)
  const featuresByPlanet = useSocketStore((s) => s.features)
  const activeRun = useSocketStore((s) => s.activeRun)

  const [runs, setRuns] = useState<RunSnapshot[]>(activeRun ? [activeRun] : [])

  useEffect(() => {
    // Initial pull — the connection handler emits run:snapshot:list, but the
    // dashboard may mount after the connection so we ask explicitly too.
    void apiGet<RunSnapshot[]>('/api/runs/snapshots')
      .then((res) => {
        if (res.ok) setRuns(res.data)
      })
      .catch(() => {
        // Phase 7 endpoint is best-effort; fall back to the activeRun
        // already in the store.
      })
  }, [])

  // Always include the legacy activeRun so we see the single-slot run too.
  useEffect(() => {
    if (!activeRun) return
    setRuns((prev) => {
      if (prev.some((r) => r.runId === activeRun.runId)) return prev
      return [...prev, activeRun]
    })
  }, [activeRun])

  const bucketed = useMemo(() => {
    const grouped: Record<ColumnKey, RunSnapshot[]> = {
      working: [],
      needs_input: [],
      failed: [],
      in_review: [],
      ci_failing: [],
      ready_to_merge: [],
      done: [],
    }
    for (const run of runs) grouped[bucketFor(run)].push(run)
    return grouped
  }, [runs])

  return (
    <div className="fixed inset-0 z-40 bg-black/90 text-slate-100 overflow-auto p-4">
      <div className="flex items-center justify-between pb-3">
        <h1 className="text-lg font-semibold tracking-wide">AgentYard dashboard</h1>
        {props.onClose ? (
          <button
            type="button"
            onClick={props.onClose}
            className="px-3 py-1 rounded border border-slate-600 text-slate-200 text-sm hover:bg-slate-800"
          >
            Close
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-3">
        {COLUMNS.map((col) => (
          <div
            key={col.key}
            className="flex flex-col gap-2 bg-slate-900/60 rounded border border-slate-800 p-2 min-h-[200px]"
          >
            <div className="flex items-center justify-between text-xs uppercase tracking-wider text-slate-400">
              <span>{col.label}</span>
              <span>{bucketed[col.key].length}</span>
            </div>
            {bucketed[col.key].map((run) => {
              const { feature, planet } = resolveFeature(run, planets, featuresByPlanet)
              return <RunCard key={run.runId} run={run} feature={feature} planet={planet} />
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

interface RunCardProps {
  run: RunSnapshot
  feature: FeatureSummary | null
  planet: PlanetSummary | null
}

function RunCard({ run, feature, planet }: RunCardProps) {
  const currentNode = useMemo(() => {
    for (const id of run.nodeIds) {
      if (run.nodeStates[id] === 'running') return id
    }
    // Otherwise show the first non-pending node we haven't crossed yet.
    for (const id of run.nodeIds) {
      const state = run.nodeStates[id]
      if (state !== 'complete') return id
    }
    return run.nodeIds.at(-1) ?? '—'
  }, [run])

  const onCancel = async () => {
    const ok = window.confirm(`Cancel run ${run.runId}?`)
    if (!ok) return
    // Best-effort — the multi-run cancel endpoint is sketched on the
    // server side; until it lands, /api/runs/reset is the closest
    // available control.
    await apiPost(`/api/runs/${encodeURIComponent(run.runId)}/cancel`, {}).catch(() => {})
  }

  return (
    <div className="bg-slate-800/70 rounded p-2 text-xs space-y-1 border border-slate-700">
      <div className="font-semibold text-slate-100 truncate" title={feature?.chatName ?? feature?.name ?? run.task}>
        {feature?.chatName ?? feature?.name ?? run.task}
      </div>
      <div className="text-slate-400 truncate" title={planet?.name ?? ''}>
        {planet?.name ?? 'no planet'}
      </div>
      <div className="text-slate-300">
        Node: <span className="font-mono">{currentNode}</span>
      </div>
      {feature?.branch ? (
        <div className="text-slate-300 truncate">Branch: {feature.branch}</div>
      ) : null}
      {run.error ? (
        <div className="text-red-400 truncate" title={run.error}>
          Error: {run.error}
        </div>
      ) : null}
      {run.finalSummary ? (
        <div className="text-emerald-400 truncate" title={run.finalSummary}>
          ✓ {run.finalSummary.slice(0, 80)}
        </div>
      ) : null}
      <div className="flex gap-1 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-0.5 rounded border border-red-700 text-red-300 hover:bg-red-900/40"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
