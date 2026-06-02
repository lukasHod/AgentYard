import { useCallback, useEffect, useMemo, useState } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { GlassButton } from '../glass/GlassButton'
import { GlassChip } from '../glass/GlassChip'
import { GlassSplitter } from '../glass/GlassSplitter'
import { GlassTab } from '../glass/GlassTab'
import { WorkflowEditorOverlay } from './WorkflowEditorOverlay'
import { SunPanelInfo } from './SunPanel'
import { useUiStore } from '../../state/uiStore'
import {
  usePlanets,
  useFeaturesMap,
  useSessionList,
  useTranscriptsMap,
  usePendingsMap,
  useConnected,
} from '../../state/socketStore'
import { sendAgentMessage, replyClarification as emitReply } from '../../state/socketClient'
import { ToolsTabContent } from '../ToolsTabContent'
import { AgentChat } from '../AgentChat'
import { EmptyMessage } from '../ui/EmptyMessage'
import { apiGet, apiPost } from '../../api'
import { pushToast } from '../../state/toastStore'
import type { PlanetSummary, FeatureSummary } from '../../../core/types'

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface PlanetDescriptionData {
  readme: string | null
  readmePath: string | null
  git: { branch?: string; head?: { sha: string; subject: string } }
  projectPath: string
  pathExists: boolean
}

type Tab = 'features' | 'tools' | 'plans' | 'description' | 'run'

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FeaturesTab({
  features,
}: {
  features: FeatureSummary[]
  planetId: number
}) {
  if (features.length === 0) {
    return <EmptyMessage>no features yet</EmptyMessage>
  }
  return (
    <ul className="space-y-2">
      {features.map((f) => (
        <li key={f.id} className="border border-sky-400/15 rounded p-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sky-300 truncate">{f.name}</span>
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
          <p className="text-slate-300 mt-1 whitespace-pre-wrap line-clamp-2 text-xs">{f.task}</p>
          {f.branch && (
            <p className="text-[10px] text-slate-500 mt-1 font-mono truncate">{f.branch}</p>
          )}
        </li>
      ))}
    </ul>
  )
}

function PlansTab({ features }: { features: FeatureSummary[] }) {
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

function DescriptionTab({
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
          README{' '}
          {data.readmePath && <span className="text-slate-400">({data.readmePath})</span>}
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

function RunTabContent({
  planetId: _planetId,
  features: _features,
}: {
  planetId: number
  features: FeatureSummary[]
}) {
  return (
    <div className="text-sm text-slate-300">Live run view lands in a future task.</div>
  )
}

// ---------------------------------------------------------------------------
// ChatPanelBody
// ---------------------------------------------------------------------------

function ChatPanelBody({
  planet,
  targetSessionId,
}: {
  planet: PlanetSummary
  /** Explicit session to render; null → auto-open the planet's ambient chat (LOD 1). */
  targetSessionId: string | null
}) {
  const sessions = useSessionList()
  const transcripts = useTranscriptsMap()
  const pendings = usePendingsMap()
  const connected = useConnected()

  const chatLabel = `planet:${planet.id}:chat`
  const ambientSession = useMemo(
    () => sessions.find((s) => s.label === chatLabel),
    [sessions, chatLabel],
  )
  const session = useMemo(
    () =>
      targetSessionId
        ? (sessions.find((s) => s.id === targetSessionId) ?? null)
        : (ambientSession ?? null),
    [targetSessionId, sessions, ambientSession],
  )

  const [opening, setOpening] = useState(false)
  const [openErr, setOpenErr] = useState<string | null>(null)

  // Reset the cached error when the user switches planets so the next planet
  // gets a fresh auto-open attempt.
  useEffect(() => {
    setOpenErr(null)
  }, [planet.id])

  const open = useCallback(async () => {
    setOpening(true)
    setOpenErr(null)
    const res = await apiPost(`/api/planets/${planet.id}/chat/open`)
    setOpening(false)
    if (!res.ok) {
      setOpenErr(res.error)
      pushToast('error', `Couldn't open chat: ${res.error}`)
    }
    // On success the server emits `session:added` which lands in the store and
    // the panel re-renders with `session` populated.
  }, [planet.id])

  // Auto-open when entering a planet that has no ambient session yet.
  // Only fires at LOD 1 (targetSessionId === null); at LOD 2 the drone session
  // is managed by the server, not by the client.
  useEffect(() => {
    if (targetSessionId !== null) return
    if (session || opening || openErr || !connected || !planet.pathExists) return
    void open()
  }, [targetSessionId, session, opening, openErr, connected, planet.pathExists, open])

  if (!session) {
    // At LOD 2 with an explicit targetSessionId: the drone is simply not connected yet.
    if (targetSessionId !== null) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
          <EmptyMessage>this drone has no live session yet.</EmptyMessage>
        </div>
      )
    }
    // LOD 1 ambient-chat empty state with retry button.
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
        <EmptyMessage>
          {openErr
            ? `couldn't open chat: ${openErr}`
            : opening
              ? 'opening chat…'
              : !planet.pathExists
                ? 'project path is missing on disk — restore the path or delete the project.'
                : !connected
                  ? 'offline — reconnect to the server to open the chat.'
                  : 'no chat yet.'}
        </EmptyMessage>
        <GlassButton
          onClick={() => void open()}
          disabled={opening || !connected || !planet.pathExists}
        >
          {openErr ? '⟳ retry' : '▶ open chat'}
        </GlassButton>
      </div>
    )
  }

  return (
    <AgentChat
      agentRunId={session.id}
      label={planet.name}
      role={session.role}
      state={session.state}
      transcript={transcripts.get(session.id) ?? []}
      pending={pendings.get(session.id) ?? null}
      connected={connected}
      onSend={(c) => sendAgentMessage(session.id, c)}
      onReply={(t, a) => emitReply(session.id, t, a)}
    />
  )
}

// ---------------------------------------------------------------------------
// ShipInfoPanel — left panel content at LOD 2
// ---------------------------------------------------------------------------

function ShipInfoPanel({ feature }: { feature: FeatureSummary }) {
  return (
    <>
      <div className="text-xs tracking-widest text-slate-400">FEATURE</div>
      <h3 className="text-sky-100 text-lg mt-1">{feature.name}</h3>
      <p className="text-sm text-slate-300 mt-2 whitespace-pre-wrap">{feature.task}</p>

      <div className="text-xs tracking-widest text-slate-400 mt-4">STATUS</div>
      <p
        className={
          feature.status === 'running'
            ? 'text-sky-300 text-sm mt-1'
            : feature.status === 'complete'
              ? 'text-emerald-300 text-sm mt-1'
              : feature.status === 'failed'
                ? 'text-rose-400 text-sm mt-1'
                : 'text-slate-400 text-sm mt-1'
        }
      >
        {feature.status}
      </p>

      <div className="text-xs tracking-widest text-slate-400 mt-4">WORKFLOW</div>
      <p className="text-sm text-slate-300 mt-1">workflow #{feature.workflowId}</p>

      {feature.branch && (
        <>
          <div className="text-xs tracking-widest text-slate-400 mt-4">BRANCH</div>
          <p className="text-xs font-mono text-slate-300 mt-1 break-all">{feature.branch}</p>
        </>
      )}

      {feature.finalSummary && (
        <>
          <div className="text-xs tracking-widest text-emerald-300 mt-4">SUMMARY</div>
          <p className="text-sm text-slate-200 whitespace-pre-wrap mt-1">{feature.finalSummary}</p>
        </>
      )}

      {feature.error && (
        <>
          <div className="text-xs tracking-widest text-rose-300 mt-4">ERROR</div>
          <p className="text-sm text-rose-200 whitespace-pre-wrap mt-1">{feature.error}</p>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// InfoPanelBody
// ---------------------------------------------------------------------------

function InfoPanelBody({ planet }: { planet: PlanetSummary }) {
  const features = useFeaturesMap().get(planet.id) ?? []
  const [tab, setTab] = useState<Tab>('features')
  const hasRunning = features.some((f) => f.status === 'running')

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        <GlassTab active={tab === 'features'} onClick={() => setTab('features')}>
          FEATURES
        </GlassTab>
        <GlassTab active={tab === 'tools'} onClick={() => setTab('tools')}>
          TOOLS
        </GlassTab>
        <GlassTab active={tab === 'plans'} onClick={() => setTab('plans')}>
          PLANS
        </GlassTab>
        <GlassTab active={tab === 'description'} onClick={() => setTab('description')}>
          DESCRIPTION
        </GlassTab>
        {hasRunning && (
          <GlassTab active={tab === 'run'} onClick={() => setTab('run')}>
            RUN
          </GlassTab>
        )}
      </div>
      {tab === 'features' && <FeaturesTab features={features} planetId={planet.id} />}
      {tab === 'tools' && <ToolsTabContent planetId={planet.id} />}
      {tab === 'plans' && <PlansTab features={features} />}
      {tab === 'description' && (
        <DescriptionTab planetId={planet.id} projectPath={planet.projectPath} />
      )}
      {tab === 'run' && <RunTabContent planetId={planet.id} features={features} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// FocusedPanel
// ---------------------------------------------------------------------------

export function FocusedPanel() {
  const focus = useUiStore((s) => s.focus)
  const back = useUiStore((s) => s.back)
  const splitterRatio = useUiStore((s) => s.splitterRatio)
  const setSplitterRatio = useUiStore((s) => s.setSplitterRatio)
  const planets = usePlanets()
  const sessions = useSessionList()
  const features = useFeaturesMap()

  const planetId =
    focus.lod === 1 && 'planetId' in focus
      ? focus.planetId
      : focus.lod === 2
        ? focus.planetId
        : null
  const planet = planetId !== null ? (planets.find((p) => p.id === planetId) ?? null) : null

  const focusedFeature = useMemo(
    () =>
      focus.lod === 2
        ? ((features.get(focus.planetId) ?? []).find((f) => f.id === focus.shipFeatureId) ?? null)
        : null,
    [focus, features],
  )

  const targetSessionId = useMemo(() => {
    if (focus.lod !== 2) return null // LOD 1 → null → ChatPanelBody opens the ambient chat
    if (focus.chatDroneId) return focus.chatDroneId
    // Default at LOD 2: bind to the leader session for this feature.
    const leader = sessions.find((s) => s.role === 'leader')
    return leader?.id ?? null
  }, [focus, sessions])

  const [wfOpen, setWfOpen] = useState(false)

  const isSunFocus = focus.lod === 1 && 'sun' in focus && focus.sun === true

  if (!isSunFocus && !planet) return null

  return (
    <div className="absolute inset-0 p-4 pointer-events-auto">
      {/* Top bar */}
      <GlassPanel className="flex items-center justify-between px-4 py-2 mb-3">
        <div className="flex items-center gap-3">
          <GlassButton variant="ghost" onClick={() => back()}>
            ← system
          </GlassButton>
          {isSunFocus ? (
            <span className="font-semibold tracking-widest text-amber-200">SUN — GLOBAL LIBRARY</span>
          ) : (
            <>
              <span className="font-semibold tracking-wide">{planet!.name}</span>
              <span className="font-mono text-xs text-slate-400">{planet!.projectPath}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <GlassChip>● link</GlassChip>
          <GlassButton variant="ghost" onClick={() => setWfOpen(true)}>⚙ workflow editor</GlassButton>
          {!isSunFocus && <GlassButton variant="danger">✕ delete</GlassButton>}
        </div>
      </GlassPanel>

      {/* Body */}
      {isSunFocus ? (
        <div className="relative" style={{ height: 'calc(100% - 80px)' }}>
          <div className="absolute inset-0 p-2">
            <GlassPanel className="h-full p-4 overflow-y-auto">
              <SunPanelInfo />
            </GlassPanel>
          </div>
        </div>
      ) : (
        <div className="relative" style={{ height: 'calc(100% - 80px)' }}>
          <div className="absolute inset-y-0 left-0 p-2" style={{ width: `${splitterRatio * 100}%` }}>
            <GlassPanel className="h-full p-4 overflow-y-auto">
              {focus.lod === 2 && focusedFeature ? (
                <ShipInfoPanel feature={focusedFeature} />
              ) : (
                <InfoPanelBody planet={planet!} />
              )}
            </GlassPanel>
          </div>

          <GlassSplitter ratio={splitterRatio} onChange={setSplitterRatio} />

          <div
            className="absolute inset-y-0 right-0 p-2"
            style={{ left: `${splitterRatio * 100}%`, paddingLeft: 12 }}
          >
            <GlassPanel className="h-full p-4 overflow-hidden">
              <ChatPanelBody planet={planet!} targetSessionId={targetSessionId} />
            </GlassPanel>
          </div>
        </div>
      )}

      <WorkflowEditorOverlay open={wfOpen} onClose={() => setWfOpen(false)} />
    </div>
  )
}
