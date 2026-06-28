import { useEffect, useState } from 'react'
import type { FeatureSummary } from '../../../core/types'
import { apiGet, apiPost } from '../../api'
import { useWaitingFeatureIds } from '../../state/socketStore'
import { pushToast } from '../../state/toastStore'
import { useUiStore } from '../../state/uiStore'
import { HandoffDialog } from '../HandoffDialog'
import { GlassButton } from '../glass/GlassButton'
import { EmptyMessage } from '../ui/EmptyMessage'

// ── Shared audit types ──────────────────────────────────────────────────────
interface AuditRunListItem {
  id: string
  featureId: number
  workflowName: string | null
  workflowSnapshotHash: string | null
  state: string
  startedAt: number | null
  completedAt: number | null
  finalSummary: string | null
  error: string | null
  nodeCount: number
  attemptCount: number
  createdAt: number
}

interface AuditNodeRun {
  id: string
  nodeId: string
  title: string
  state: string
  nodeType: string | null
  summary: string | null
  startedAt: number | null
  endedAt: number | null
  attemptCount: number
}

interface AuditSession {
  id: string
  nodeRunId: string | null
  agentName: string | null
  role: string
  runtimeKind: string
  model: string | null
  enforcementStatus: string
  enforcementReason: string | null
  skillNames: string[]
  mcpNames: string[]
  effectiveTools: string[]
  state: string
}

interface AuditRunDetail {
  run: {
    id: string
    featureId: number
    workflowName: string | null
    workflowSnapshotHash: string | null
    task: string
    state: string
    branch: string | null
    worktreePath: string | null
    startedAt: number | null
    completedAt: number | null
    finalSummary: string | null
    error: string | null
    createdAt: number
  }
  nodeRuns: AuditNodeRun[]
  attempts: Array<{
    id: number
    nodeRunId: string
    attemptNumber: number
    status: string
    startedAt: number
    completedAt: number | null
    summary: string | null
    error: string | null
  }>
  sessions: AuditSession[]
}

interface AuditEvent {
  id: number
  runId: string
  nodeRunId: string | null
  nodeAttemptId: number | null
  sessionId: string | null
  eventType: string
  title: string
  summary: string | null
  detailsJson: string | null
  severity: string
  createdAt: number
}

interface PlanetDescriptionData {
  readme: string | null
  readmePath: string | null
  git: { branch?: string; head?: { sha: string; subject: string } }
  projectPath: string
  pathExists: boolean
}

export function FeaturesTab({
  features,
  planetId,
}: {
  features: FeatureSummary[]
  planetId: number
}) {
  const [handoffTarget, setHandoffTarget] = useState<FeatureSummary | null>(null)
  const [creating, setCreating] = useState(false)
  const focusShip = useUiStore((s) => s.focusShip)
  const focus = useUiStore((s) => s.focus)
  const waitingFeatureIds = useWaitingFeatureIds()

  const handleNewFeature = async () => {
    setCreating(true)
    const res = await apiPost<FeatureSummary>(`/api/planets/${planetId}/features`)
    setCreating(false)
    if (res.ok) {
      focusShip(planetId, res.data.id)
    } else {
      pushToast('error', `Couldn't create feature: ${res.error}`)
    }
  }

  return (
    <>
      {handoffTarget && (
        <HandoffDialog
          planetId={planetId}
          feature={handoffTarget}
          onClose={() => setHandoffTarget(null)}
        />
      )}
      <div className="mb-3">
        <GlassButton
          variant="primary"
          className="text-xs"
          onClick={() => void handleNewFeature()}
          disabled={creating}
        >
          {creating ? 'creating…' : '+ New Feature'}
        </GlassButton>
      </div>
      {features.length === 0 ? (
        <EmptyMessage>no features yet</EmptyMessage>
      ) : (
        <ul className="space-y-2">
          {features.map((f) => {
            const isActive = focus.lod === 2 && focus.shipFeatureId === f.id
            const isWaiting = waitingFeatureIds.has(f.id)
            return (
              <li
                key={f.id}
                className={`border rounded p-2 cursor-pointer transition-colors ${
                  isWaiting
                    ? isActive
                      ? 'border-amber-300/60 bg-amber-400/10'
                      : 'border-amber-400/30 hover:border-amber-300/60 hover:bg-amber-400/5'
                    : isActive
                      ? 'border-sky-400/60 bg-sky-400/10'
                      : 'border-sky-400/15 hover:border-sky-400/30 hover:bg-sky-400/5'
                }`}
                onClick={() => focusShip(planetId, f.id)}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isWaiting && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                    )}
                    <span className={`truncate ${isWaiting ? 'text-amber-200' : 'text-sky-300'}`}>
                      {f.chatName ?? f.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isWaiting && (
                      <span className="text-[10px] tracking-widest text-amber-300">waiting</span>
                    )}
                    {f.status !== 'done' && f.status !== 'complete' && (
                      <GlassButton
                        variant="ghost"
                        className="text-[10px] py-0 px-1.5"
                        onClick={(e) => {
                          e.stopPropagation()
                          setHandoffTarget(f)
                        }}
                      >
                        hand off
                      </GlassButton>
                    )}
                    <span
                      className={`text-[10px] tracking-widest ${
                        f.status === 'running'
                          ? 'text-sky-300'
                          : f.status === 'complete'
                            ? 'text-emerald-300'
                            : f.status === 'failed'
                              ? 'text-rose-400'
                              : 'text-slate-500'
                      }`}
                    >
                      {f.status}
                    </span>
                  </div>
                </div>
                <p className="text-slate-300 mt-1 whitespace-pre-wrap line-clamp-2 text-xs">
                  {f.description ?? f.task}
                </p>
                {f.branch && (
                  <p className="text-[10px] text-slate-500 mt-1 font-mono truncate">{f.branch}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export function PlansTab({ features }: { features: FeatureSummary[] }) {
  if (features.length === 0) {
    return (
      <EmptyMessage>
        no plans recorded yet. each feature run records its task + summary here.
      </EmptyMessage>
    )
  }
  return (
    <ul className="space-y-3">
      {features.map((f) => (
        <li key={f.id} className="border border-sky-400/15 rounded p-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sky-300">{f.name}</span>
            <span className="text-[10px] text-slate-500">
              {new Date(f.createdAt).toLocaleDateString()}
            </span>
          </div>
          <div className="mt-1 text-[10px] tracking-widest text-slate-500">TASK</div>
          <p className="text-slate-200 whitespace-pre-wrap text-xs">{f.task}</p>
          {f.finalSummary && (
            <>
              <div className="mt-2 text-[10px] tracking-widest text-emerald-300">OUTCOME</div>
              <p className="text-slate-200 whitespace-pre-wrap text-xs">{f.finalSummary}</p>
            </>
          )}
          {f.error && (
            <>
              <div className="mt-2 text-[10px] tracking-widest text-rose-400">ERROR</div>
              <p className="text-rose-300 whitespace-pre-wrap text-xs">{f.error}</p>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

export function DescriptionTab({
  planetId,
  projectPath,
}: {
  planetId: number
  projectPath: string
}) {
  const [data, setData] = useState<PlanetDescriptionData | null>(null)

  useEffect(() => {
    setData(null)
    const controller = new AbortController()
    void apiGet<PlanetDescriptionData>(`/api/planets/${planetId}/description`, {
      signal: controller.signal,
    }).then((res) => {
      if (controller.signal.aborted) return
      if (res.ok) {
        setData(res.data)
      } else if (!res.aborted) {
        setData({
          readme: null,
          readmePath: null,
          git: {},
          projectPath,
          pathExists: false,
        })
      }
    })
    return () => controller.abort()
  }, [planetId, projectPath])

  if (data === null) return <EmptyMessage>loading...</EmptyMessage>

  return (
    <div className="space-y-3 text-xs">
      {!data.pathExists && (
        <div className="border border-rose-400/60 bg-rose-500/10 rounded p-2 text-rose-200">
          <div className="text-[10px] tracking-widest text-rose-300 mb-0.5">PATH MISSING</div>
          <p>
            The project path no longer exists on disk. Worktree creation and feature runs will fail
            until the path is restored or the project is deleted (use the ✕ in the header).
          </p>
        </div>
      )}
      <section className="space-y-1">
        <h3 className="text-[10px] tracking-widest text-slate-500">PROJECT PATH</h3>
        <p className="text-slate-300 font-mono break-all">{data.projectPath}</p>
      </section>
      <section className="space-y-1">
        <h3 className="text-[10px] tracking-widest text-slate-500">GIT</h3>
        {data.git.branch ? (
          <>
            <p className="text-slate-300">
              branch: <span className="text-sky-300 font-mono">{data.git.branch}</span>
            </p>
            {data.git.head && (
              <p className="text-slate-300">
                head: <span className="text-sky-300 font-mono">{data.git.head.sha}</span>{' '}
                <span className="text-slate-400">— {data.git.head.subject}</span>
              </p>
            )}
          </>
        ) : (
          <EmptyMessage>no git info</EmptyMessage>
        )}
      </section>
      <section className="space-y-1">
        <h3 className="text-[10px] tracking-widest text-slate-500">
          README {data.readmePath && <span className="text-slate-400">({data.readmePath})</span>}
        </h3>
        {data.readme === null ? (
          <EmptyMessage>no README found at repo root</EmptyMessage>
        ) : (
          <pre className="text-slate-200 whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-zinc-950 border border-sky-400/15 rounded p-2 overflow-x-auto max-h-96 overflow-y-auto">
            {data.readme}
          </pre>
        )}
      </section>
    </div>
  )
}

// ── RunsTab ─────────────────────────────────────────────────────────────────

function fmtDuration(startedAt: number | null, completedAt: number | null): string {
  if (!startedAt) return '—'
  const endMs = completedAt ?? Date.now()
  const s = Math.round((endMs - startedAt) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function stateColor(state: string): string {
  if (state === 'done') return 'text-emerald-400'
  if (state === 'running' || state === 'not_started') return 'text-sky-400'
  if (state === 'terminated') return 'text-rose-400'
  return 'text-slate-400'
}

function EnforcementBadge({ status, reason }: { status: string; reason: string | null }) {
  if (status === 'verified') return null
  const color = status === 'partial' ? 'text-amber-400 border-amber-400/40' : 'text-slate-400 border-slate-400/30'
  return (
    <span className={`text-[9px] border rounded px-1 ${color}`} title={reason ?? undefined}>
      {status}
    </span>
  )
}

function AgentCapabilityCard({ session }: { session: AuditSession }) {
  return (
    <div className="border border-sky-400/10 rounded p-1.5 text-[10px] space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-sky-300 font-medium">{session.agentName ?? session.role}</span>
        <span className="text-slate-500">{session.role}</span>
        <EnforcementBadge status={session.enforcementStatus} reason={session.enforcementReason} />
        <span className={`ml-auto ${session.state === 'done' ? 'text-emerald-400' : session.state === 'terminated' ? 'text-rose-400' : 'text-sky-400'}`}>
          {session.state}
        </span>
      </div>
      {session.model && <div className="text-slate-500">model: <span className="text-slate-300">{session.model}</span></div>}
      {session.runtimeKind !== 'sdk' && (
        <div className="text-amber-400">runtime: {session.runtimeKind}</div>
      )}
      {session.skillNames.length > 0 && (
        <div className="text-slate-500">skills: <span className="text-slate-300">{session.skillNames.join(', ')}</span></div>
      )}
      {session.mcpNames.length > 0 && (
        <div className="text-slate-500">mcps: <span className="text-slate-300">{session.mcpNames.join(', ')}</span></div>
      )}
    </div>
  )
}

function AuditEventRow({ ev }: { ev: AuditEvent }) {
  const [open, setOpen] = useState(false)
  const severityColor = ev.severity === 'error' ? 'text-rose-400' : ev.severity === 'warning' ? 'text-amber-400' : ev.severity === 'success' ? 'text-emerald-400' : 'text-slate-400'
  const time = new Date(ev.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div className="border-b border-slate-700/40 py-1">
      <div className="flex items-start gap-2">
        <span className="text-[9px] text-slate-600 shrink-0 mt-0.5">{time}</span>
        <span className={`text-[10px] ${severityColor} shrink-0 w-1.5 mt-0.5`}>•</span>
        <span className="text-xs text-slate-200 flex-1">{ev.title}</span>
        {ev.detailsJson && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[9px] text-slate-500 hover:text-sky-400 shrink-0"
          >
            {open ? '▲' : '▼'}
          </button>
        )}
      </div>
      {ev.summary && <p className="text-[10px] text-slate-400 ml-10 mt-0.5">{ev.summary}</p>}
      {open && ev.detailsJson && (
        <pre className="text-[9px] text-slate-500 ml-10 mt-1 overflow-x-auto">
          {JSON.stringify(JSON.parse(ev.detailsJson), null, 2)}
        </pre>
      )}
    </div>
  )
}

function RunDetail({ runId }: { runId: string }) {
  const [detail, setDetail] = useState<AuditRunDetail | null>(null)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [activeTab, setActiveTab] = useState<'summary' | 'evidence'>('summary')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setDetail(null)
    setEvents([])
    const ctrl = new AbortController()
    void Promise.all([
      apiGet<AuditRunDetail>(`/api/workflow-runs/${runId}`, { signal: ctrl.signal }),
      apiGet<{ events: AuditEvent[] }>(`/api/workflow-runs/${runId}/events?limit=100`, { signal: ctrl.signal }),
    ]).then(([det, evs]) => {
      if (ctrl.signal.aborted) return
      if (det.ok) setDetail(det.data)
      if (evs.ok) setEvents(evs.data.events)
      setLoading(false)
    })
    return () => ctrl.abort()
  }, [runId])

  if (loading) return <EmptyMessage>loading...</EmptyMessage>
  if (!detail) return <EmptyMessage>run not found.</EmptyMessage>

  const { run, nodeRuns, sessions } = detail

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('summary')}
          className={`text-[10px] tracking-widest px-2 py-0.5 border rounded ${activeTab === 'summary' ? 'border-sky-400/60 text-sky-300' : 'border-slate-600/40 text-slate-500 hover:border-slate-500'}`}
        >
          SUMMARY
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('evidence')}
          className={`text-[10px] tracking-widest px-2 py-0.5 border rounded ${activeTab === 'evidence' ? 'border-sky-400/60 text-sky-300' : 'border-slate-600/40 text-slate-500 hover:border-slate-500'}`}
        >
          EVIDENCE ({events.length})
        </button>
      </div>

      {activeTab === 'summary' && (
        <div className="space-y-3 text-xs">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${stateColor(run.state)}`}>{run.state.toUpperCase()}</span>
            {run.workflowSnapshotHash && (
              <span className="text-slate-500 font-mono">#{run.workflowSnapshotHash}</span>
            )}
            <span className="text-slate-500 ml-auto">{fmtDuration(run.startedAt, run.completedAt)}</span>
          </div>
          {run.workflowName && (
            <div className="text-slate-400">
              <span className="text-[10px] tracking-widest text-slate-500">WORKFLOW </span>{run.workflowName}
            </div>
          )}
          {run.task && (
            <div>
              <div className="text-[10px] tracking-widest text-slate-500 mb-0.5">TASK</div>
              <p className="text-slate-200 whitespace-pre-wrap">{run.task}</p>
            </div>
          )}
          {run.finalSummary && (
            <div>
              <div className="text-[10px] tracking-widest text-emerald-300 mb-0.5">OUTCOME</div>
              <p className="text-slate-200 whitespace-pre-wrap">{run.finalSummary}</p>
            </div>
          )}
          {run.error && (
            <div>
              <div className="text-[10px] tracking-widest text-rose-400 mb-0.5">ERROR</div>
              <p className="text-rose-300 whitespace-pre-wrap">{run.error}</p>
            </div>
          )}
          {nodeRuns.length > 0 && (
            <div>
              <div className="text-[10px] tracking-widest text-slate-500 mb-1">NODES</div>
              <div className="space-y-1">
                {nodeRuns.map((nr) => (
                  <div key={nr.id} className="flex items-center gap-2 border border-sky-400/10 rounded px-2 py-1">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${nr.state === 'complete' ? 'bg-emerald-400' : nr.state === 'failed' ? 'bg-rose-400' : nr.state === 'running' ? 'bg-sky-400' : nr.state === 'skipped' ? 'bg-slate-500' : 'bg-slate-600'}`} />
                    <span className="text-slate-200 flex-1">{nr.title}</span>
                    {nr.attemptCount > 1 && (
                      <span className="text-amber-400 text-[9px]">{nr.attemptCount} attempts</span>
                    )}
                    <span className={`text-[9px] ${stateColor(nr.state)}`}>{nr.state}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {sessions.length > 0 && (
            <div>
              <div className="text-[10px] tracking-widest text-slate-500 mb-1">AGENTS</div>
              <div className="space-y-1">
                {sessions.map((s) => (
                  <AgentCapabilityCard key={s.id} session={s} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'evidence' && (
        <div className="space-y-0">
          {events.length === 0 ? (
            <EmptyMessage>no events recorded yet.</EmptyMessage>
          ) : (
            events.map((ev) => <AuditEventRow key={ev.id} ev={ev} />)
          )}
        </div>
      )}
    </div>
  )
}

// ── FeatureRunsSection — inline per-feature RUNS panel for ShipInfoPanel ───
export function FeatureRunsSection({ featureId }: { featureId: number }) {
  const [runs, setRuns] = useState<AuditRunListItem[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    void apiGet<AuditRunListItem[]>(`/api/features/${featureId}/runs`, { signal: ctrl.signal }).then((res) => {
      if (ctrl.signal.aborted) return
      if (res.ok) setRuns(res.data)
    })
    return () => ctrl.abort()
  }, [featureId])

  if (selectedRunId) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => setSelectedRunId(null)} className="text-[10px] tracking-widest text-sky-400 hover:text-sky-200">
          ← BACK
        </button>
        <RunDetail runId={selectedRunId} />
      </div>
    )
  }

  if (runs.length === 0) {
    return <EmptyMessage>no runs yet.</EmptyMessage>
  }

  return (
    <ul className="space-y-1">
      {runs.map((run) => (
        <li key={run.id}>
          <button
            type="button"
            onClick={() => setSelectedRunId(run.id)}
            className="w-full text-left border border-sky-400/15 rounded px-2 py-1.5 hover:border-sky-400/40 hover:bg-sky-400/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-xs">
              <span className={`font-medium ${stateColor(run.state)}`}>{run.state.toUpperCase()}</span>
              {run.workflowName && <span className="text-slate-400 truncate flex-1">{run.workflowName}</span>}
              {run.workflowSnapshotHash && <span className="text-slate-600 font-mono text-[9px] shrink-0">#{run.workflowSnapshotHash}</span>}
              <span className="text-slate-500 text-[9px] shrink-0">{fmtDuration(run.startedAt, run.completedAt)}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[9px] text-slate-500">
              <span>{run.nodeCount} nodes</span>
              {run.attemptCount > run.nodeCount && <span className="text-amber-400">{run.attemptCount - run.nodeCount} retries</span>}
              {run.startedAt && <span className="ml-auto">{new Date(run.startedAt).toLocaleString()}</span>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function RunsTab({ features }: { features: FeatureSummary[] }) {
  const [runsByFeature, setRunsByFeature] = useState<Record<number, AuditRunListItem[]>>({})
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [loadingFeatureId, setLoadingFeatureId] = useState<number | null>(null)

  useEffect(() => {
    if (features.length === 0) return
    const ctrl = new AbortController()
    void Promise.all(
      features.map((f) =>
        apiGet<AuditRunListItem[]>(`/api/features/${f.id}/runs`, { signal: ctrl.signal }).then(
          (res) => ({ featureId: f.id, runs: res.ok ? res.data : [] }),
        ),
      ),
    ).then((results) => {
      if (ctrl.signal.aborted) return
      const map: Record<number, AuditRunListItem[]> = {}
      for (const r of results) map[r.featureId] = r.runs
      setRunsByFeature(map)
    })
    return () => ctrl.abort()
  }, [features])

  const featuresWithRuns = features.filter((f) => (runsByFeature[f.id]?.length ?? 0) > 0)

  if (selectedRunId) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setSelectedRunId(null)}
          className="text-[10px] tracking-widest text-sky-400 hover:text-sky-200"
        >
          ← BACK TO RUNS
        </button>
        <RunDetail runId={selectedRunId} />
      </div>
    )
  }

  if (featuresWithRuns.length === 0 && Object.keys(runsByFeature).length === features.length) {
    return <EmptyMessage>no workflow runs recorded yet. start a feature workflow to see run history here.</EmptyMessage>
  }

  return (
    <div className="space-y-4">
      {features.map((feature) => {
        const runs = runsByFeature[feature.id]
        if (!runs || runs.length === 0) return null
        return (
          <div key={feature.id}>
            <div className="text-[10px] tracking-widest text-slate-500 mb-1">
              {feature.name}
            </div>
            <ul className="space-y-1">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    className="w-full text-left border border-sky-400/15 rounded px-2 py-1.5 hover:border-sky-400/40 hover:bg-sky-400/5 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`font-medium ${stateColor(run.state)}`}>
                        {run.state.toUpperCase()}
                      </span>
                      {run.workflowName && (
                        <span className="text-slate-400 truncate flex-1">{run.workflowName}</span>
                      )}
                      {run.workflowSnapshotHash && (
                        <span className="text-slate-600 font-mono text-[9px] shrink-0">#{run.workflowSnapshotHash}</span>
                      )}
                      <span className="text-slate-500 text-[9px] shrink-0">
                        {fmtDuration(run.startedAt, run.completedAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[9px] text-slate-500">
                      <span>{run.nodeCount} nodes</span>
                      {run.attemptCount > run.nodeCount && (
                        <span className="text-amber-400">{run.attemptCount - run.nodeCount} retries</span>
                      )}
                      {run.startedAt && (
                        <span className="ml-auto">{new Date(run.startedAt).toLocaleString()}</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
