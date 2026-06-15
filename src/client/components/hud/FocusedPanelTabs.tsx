import { useEffect, useState } from 'react'
import type { FeatureSummary } from '../../../core/types'
import { apiGet, apiPost } from '../../api'
import { useWaitingFeatureIds } from '../../state/socketStore'
import { pushToast } from '../../state/toastStore'
import { useUiStore } from '../../state/uiStore'
import { HandoffDialog } from '../HandoffDialog'
import { GlassButton } from '../glass/GlassButton'
import { EmptyMessage } from '../ui/EmptyMessage'

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
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formTask, setFormTask] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const focusShip = useUiStore((s) => s.focusShip)
  const focus = useUiStore((s) => s.focus)
  const waitingFeatureIds = useWaitingFeatureIds()

  const handleSubmit = async () => {
    setSubmitting(true)
    const res = await apiPost<FeatureSummary>(`/api/planets/${planetId}/features`, {
      name: formName.trim() || undefined,
      task: formTask.trim(),
    })
    setSubmitting(false)
    if (res.ok) {
      setShowForm(false)
      setFormName('')
      setFormTask('')
      focusShip(planetId, res.data.id)
    } else {
      pushToast('error', `Couldn't create feature: ${res.error}`)
    }
  }

  const handleCancel = () => {
    setShowForm(false)
    setFormName('')
    setFormTask('')
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

      {showForm ? (
        <div className="mb-3 space-y-2">
          <input
            className="w-full bg-black/40 border border-sky-400/30 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-300"
            placeholder="feature-name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            autoFocus
          />
          <textarea
            className="w-full bg-black/40 border border-sky-400/30 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-300 resize-none"
            placeholder="Describe what to build…"
            rows={4}
            value={formTask}
            onChange={(e) => setFormTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void handleSubmit()
              }
            }}
          />
          <div className="flex gap-2">
            <GlassButton
              variant="primary"
              className="text-xs"
              onClick={() => void handleSubmit()}
              disabled={submitting || !formTask.trim()}
            >
              {submitting ? 'Starting…' : 'Start'}
            </GlassButton>
            <GlassButton
              variant="ghost"
              className="text-xs"
              onClick={handleCancel}
              disabled={submitting}
            >
              Cancel
            </GlassButton>
          </div>
          <p className="text-[10px] text-slate-500">Cmd/Ctrl+Enter to submit</p>
        </div>
      ) : (
        <div className="mb-3">
          <GlassButton
            variant="primary"
            className="text-xs"
            onClick={() => setShowForm(true)}
          >
            + New Feature
          </GlassButton>
        </div>
      )}
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
