import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { GlassButton } from '../glass/GlassButton'
import { GlassSplitter } from '../glass/GlassSplitter'
import { GlassTab } from '../glass/GlassTab'
import { WorkflowEditorOverlay } from './WorkflowEditorOverlay'
import { SunPanelInfo } from './SunPanel'
import { useUiStore, type InfoTab } from '../../state/uiStore'
import {
  useSocketStore,
  usePlanets,
  useFeaturesMap,
  useConnected,
  useTerminalsByPlanet,
} from '../../state/socketStore'
import {
  startTerminal,
  restartTerminal,
  deleteTerminal,
} from '../../state/socketClient'
import { ToolsTabContent } from '../ToolsTabContent'
import { TerminalPanel } from '../TerminalPanel'
import { EmptyMessage } from '../ui/EmptyMessage'
import { HandoffsTab } from '../HandoffsTab'
import { HandoffDialog } from '../HandoffDialog'
import { apiGet, apiPost, apiDelete } from '../../api'
import { pushToast } from '../../state/toastStore'
import { useNotificationRows } from '../hud/useNotificationRows'
import type {
  ClientEvents,
  PlanetSummary,
  FeatureSummary,
  TerminalProfileId,
  TerminalSessionDescriptor,
} from '../../../core/types'

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

type Tab = InfoTab

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FeaturesTab({
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
            return (
              <li
                key={f.id}
                className={`border rounded p-2 cursor-pointer transition-colors ${
                  isActive
                    ? 'border-sky-400/60 bg-sky-400/10'
                    : 'border-sky-400/15 hover:border-sky-400/30 hover:bg-sky-400/5'
                }`}
                onClick={() => focusShip(planetId, f.id)}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sky-300 truncate">{f.chatName ?? f.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {f.status !== 'done' && f.status !== 'complete' && (
                      <GlassButton
                        variant="ghost"
                        className="text-[10px] py-0 px-1.5"
                        onClick={(e) => { e.stopPropagation(); setHandoffTarget(f) }}
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
// TerminalsTab
// ---------------------------------------------------------------------------

const DEFAULT_TERMINAL_PROFILE: TerminalProfileId =
  typeof navigator !== 'undefined' && /Win/.test(navigator.platform) ? 'powershell' : 'unix-shell'

const TERMINAL_PROFILE_OPTIONS: { id: TerminalProfileId; label: string }[] = [
  { id: 'powershell', label: 'powershell' },
  { id: 'unix-shell', label: 'shell' },
  { id: 'claude-cli', label: 'claude' },
  { id: 'codex-cli', label: 'codex' },
]

const TERMINAL_STATE_COLOR: Record<TerminalSessionDescriptor['state'], string> = {
  running: 'text-sky-300',
  exited: 'text-slate-400',
  killed: 'text-rose-300',
  failed: 'text-rose-400',
  runtime_lost: 'text-amber-300',
}

function TerminalsTab({ planet }: { planet: PlanetSummary }) {
  const terminals = useTerminalsByPlanet(planet.id)
  const selectedSessionId = useUiStore(
    (s) => s.selectedTerminalByPlanet[planet.id] ?? null,
  )
  const selectTerminal = useUiStore((s) => s.selectTerminal)
  const [profileId, setProfileId] = useState<TerminalProfileId>(DEFAULT_TERMINAL_PROFILE)
  const connected = useConnected()

  // After clicking "+ new terminal" we want to auto-select whichever
  // descriptor the server hands back. Snapshot the current ids; the first
  // unknown id that arrives after `startTerminal` wins.
  const pendingSpawnRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    const known = pendingSpawnRef.current
    if (!known) return
    const fresh = terminals.find((t) => !known.has(t.id))
    if (fresh) {
      pendingSpawnRef.current = null
      selectTerminal(planet.id, fresh.id)
    }
  }, [terminals, planet.id, selectTerminal])

  const spawn = () => {
    if (!connected) return
    pendingSpawnRef.current = new Set(terminals.map((t) => t.id))
    startTerminal({
      profileId,
      planetId: planet.id,
      cwd: planet.projectPath,
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] tracking-widest text-slate-500">PROFILE</span>
        <select
          value={profileId}
          onChange={(e) => setProfileId(e.target.value as TerminalProfileId)}
          className="bg-black border border-sky-400/30 text-xs px-2 py-1 rounded focus:outline-none focus:border-sky-300"
        >
          {TERMINAL_PROFILE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
        <GlassButton
          variant="primary"
          className="text-xs"
          onClick={spawn}
          disabled={!connected || !planet.pathExists}
        >
          + new terminal
        </GlassButton>
      </div>
      {terminals.length === 0 ? (
        <EmptyMessage>no terminal sessions yet</EmptyMessage>
      ) : (
        <ul className="space-y-1">
          {terminals.map((t) => {
            const isActive = selectedSessionId === t.id
            return (
              <li
                key={t.id}
                className={`border rounded p-2 cursor-pointer transition-colors text-xs ${
                  isActive
                    ? 'border-sky-400/60 bg-sky-400/10'
                    : 'border-sky-400/15 hover:border-sky-400/30 hover:bg-sky-400/5'
                }`}
                onClick={() => selectTerminal(planet.id, t.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sky-300 font-mono truncate">{t.id}</span>
                  <span className={`text-[10px] tracking-widest ${TERMINAL_STATE_COLOR[t.state]}`}>
                    {t.state}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 truncate font-mono">
                  {t.argv.join(' ')}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-slate-500">profile: {t.profileId}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (selectedSessionId === t.id) selectTerminal(planet.id, null)
                      deleteTerminal(t.id)
                    }}
                    className="text-[10px] tracking-widest text-rose-300 hover:text-rose-200"
                    title={t.state === 'running' ? 'kill and remove' : 'remove'}
                  >
                    × remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ChatOrTerminal — picks between AgentChat and TerminalPanel
// ---------------------------------------------------------------------------

const TERMINAL_DEAD_STATES: ReadonlySet<TerminalSessionDescriptor['state']> = new Set([
  'exited',
  'killed',
  'failed',
  'runtime_lost',
])

/** Pick "the" terminal for a scope: alive ones beat dead ones, newer beats
 *  older. Returns `null` when no terminal matches the scope yet. */
function pickScopedTerminal(
  terminals: TerminalSessionDescriptor[],
  scope: { planetId: number; featureId: number | null; role: string },
): TerminalSessionDescriptor | null {
  const matching = terminals.filter(
    (t) =>
      t.planetId === scope.planetId &&
      t.featureId === scope.featureId &&
      t.role === scope.role,
  )
  if (matching.length === 0) return null
  matching.sort((a, b) => {
    const aDead = TERMINAL_DEAD_STATES.has(a.state) ? 1 : 0
    const bDead = TERMINAL_DEAD_STATES.has(b.state) ? 1 : 0
    if (aDead !== bDead) return aDead - bDead
    return b.createdAt - a.createdAt
  })
  return matching[0] ?? null
}

function TerminalHeader({
  title,
  subtitle,
  onClose,
  onRestart,
}: {
  title: string
  subtitle: string
  onClose?: () => void
  onRestart?: () => void
}) {
  return (
    <div className="border-b border-cyan-500/30 px-3 py-2 flex items-center justify-between text-xs shrink-0">
      <div>
        <span className="text-fuchsia-300 mr-2 tracking-wide">{title}</span>
        <span className="text-cyan-200 font-mono">{subtitle}</span>
      </div>
      <div className="flex items-center gap-3">
        {onRestart && (
          <button
            type="button"
            onClick={onRestart}
            className="text-[10px] tracking-widest text-sky-300 hover:text-sky-200"
          >
            ⟳ restart
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] tracking-widest text-slate-400 hover:text-sky-300"
          >
            close ✕
          </button>
        )}
      </div>
    </div>
  )
}

interface ScopedTerminalProps {
  /** Header label, e.g. "TERMINAL" or "LEADER". */
  title: string
  subtitle: string
  /** Scope keys the descriptor must match. */
  scope: { planetId: number; featureId: number | null; role: string }
  spawnReq: ClientEvents['terminal:start']
  available: boolean
  unavailableMessage: string
}

/**
 * Generic primary-terminal renderer: looks up the active terminal for a
 * scope (planet/feature/role), auto-spawns when missing, and restarts a
 * dead one on demand. Session ids are server-generated; we never preassign
 * them. The in-flight ref guards against StrictMode double-mounts so the
 * spawn fires exactly once per scope until the descriptor arrives.
 */
function ScopedPrimaryTerminal({
  title,
  subtitle,
  scope,
  spawnReq,
  available,
  unavailableMessage,
}: ScopedTerminalProps) {
  const connected = useConnected()
  const terminals = useTerminalsByPlanet(scope.planetId)
  const descriptor = pickScopedTerminal(terminals, scope)
  // Guards a single in-flight spawn per scope. We clear it once the matching
  // descriptor arrives, OR when the scope changes (planet/feature/role).
  const spawnInFlightRef = useRef(false)
  const scopeKey = `${scope.planetId}:${scope.featureId ?? ''}:${scope.role}`
  const lastScopeKeyRef = useRef(scopeKey)
  if (lastScopeKeyRef.current !== scopeKey) {
    lastScopeKeyRef.current = scopeKey
    spawnInFlightRef.current = false
  }
  if (descriptor) spawnInFlightRef.current = false

  useEffect(() => {
    if (!connected || !available) return
    if (descriptor) return
    if (spawnInFlightRef.current) return
    spawnInFlightRef.current = true
    startTerminal(spawnReq)
  }, [connected, available, descriptor, spawnReq])

  const restart = () => {
    if (!connected || !available || !descriptor) return
    restartTerminal(descriptor.id)
  }

  if (!available) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
        <EmptyMessage>{unavailableMessage}</EmptyMessage>
      </div>
    )
  }

  if (!descriptor) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
        <EmptyMessage>{connected ? 'spinning up terminal…' : 'offline — reconnect to start a terminal.'}</EmptyMessage>
      </div>
    )
  }

  const dead = TERMINAL_DEAD_STATES.has(descriptor.state)

  return (
    <div className="flex flex-col h-full text-sm">
      <TerminalHeader
        title={title}
        subtitle={subtitle}
        onRestart={dead ? restart : undefined}
      />
      <div className="flex-1 relative">
        <TerminalPanel sessionId={descriptor.id} />
      </div>
    </div>
  )
}

function PrimaryPlanetTerminal({ planet }: { planet: PlanetSummary }) {
  // Stable identity for the spawn request so `useEffect` doesn't refire
  // every render. Re-derives only when the planet identity / path changes.
  const spawnReq = useMemo<ClientEvents['terminal:start']>(
    () => ({
      profileId: DEFAULT_TERMINAL_PROFILE,
      planetId: planet.id,
      cwd: planet.projectPath,
      role: 'free',
    }),
    [planet.id, planet.projectPath],
  )
  return (
    <ScopedPrimaryTerminal
      title="TERMINAL"
      subtitle={planet.name}
      scope={{ planetId: planet.id, featureId: null, role: 'free' }}
      spawnReq={spawnReq}
      available={planet.pathExists}
      unavailableMessage="project path is missing on disk — restore the path or delete the project."
    />
  )
}

/**
 * Workspace shown at LOD 2 for a focused feature. A tab strip lists every
 * terminal scoped to the feature (LEADER, SHELL #N, plus any role spawned
 * by the workflow engine later), with a "+ shell" affordance for ad-hoc
 * shells. The selected tab's terminal fills the body. The leader tab is
 * always present even before its terminal exists — clicking it triggers
 * the auto-spawn through `ScopedPrimaryTerminal`.
 */
function FeatureWorkspace({
  planet,
  feature,
}: {
  planet: PlanetSummary
  feature: FeatureSummary
}) {
  const cwd = feature.worktreePath ?? planet.projectPath
  const connected = useConnected()
  const terminals = useTerminalsByPlanet(planet.id)
  const featureTerminals = useMemo(
    () => terminals.filter((t) => t.featureId === feature.id),
    [terminals, feature.id],
  )
  const selectedId = useUiStore((s) => s.selectedTabByFeature[feature.id] ?? null)
  const selectFeatureTab = useUiStore((s) => s.selectFeatureTab)

  const leaderSpawnReq = useMemo<ClientEvents['terminal:start']>(
    () => ({
      profileId: DEFAULT_TERMINAL_PROFILE,
      planetId: planet.id,
      featureId: feature.id,
      cwd,
      role: 'leader',
    }),
    [planet.id, feature.id, cwd],
  )

  const leaderTerminal = pickScopedTerminal(featureTerminals, {
    planetId: planet.id,
    featureId: feature.id,
    role: 'leader',
  })

  // Build the tab list. Leader is always present. Other roles surface as the
  // server spawns them. For duplicates within a role we suffix "·2", "·3"
  // in createdAt order so each terminal stays distinguishable.
  const tabs = useMemo<FeatureTab[]>(() => {
    const out: FeatureTab[] = []
    const leaderTabId = leaderTerminal?.id ?? '__leader_placeholder__'
    out.push({
      key: leaderTabId,
      label: 'LEADER',
      role: 'leader',
      terminal: leaderTerminal,
    })
    const byRole = new Map<string, TerminalSessionDescriptor[]>()
    for (const t of featureTerminals) {
      if (t.role === 'leader') continue
      const r = t.role ?? t.profileId
      const arr = byRole.get(r) ?? []
      arr.push(t)
      byRole.set(r, arr)
    }
    for (const [role, list] of byRole) {
      list.sort((a, b) => a.createdAt - b.createdAt)
      list.forEach((t, idx) => {
        const baseLabel =
          role === 'shell' || role === t.profileId ? 'SHELL' : role.toUpperCase()
        const label = list.length > 1 ? `${baseLabel}·${idx + 1}` : baseLabel
        out.push({ key: t.id, label, role, terminal: t })
      })
    }
    return out
  }, [featureTerminals, leaderTerminal])

  // Resolve the active tab. If the stored selection still matches, use it;
  // otherwise default to the leader tab.
  const activeTab = useMemo(() => {
    if (selectedId) {
      const match = tabs.find((t) => t.key === selectedId)
      if (match) return match
    }
    return tabs[0]!
  }, [tabs, selectedId])

  const spawnShell = () => {
    if (!connected) return
    // Snapshot BEFORE sending so the new id is guaranteed not to be in the
    // baseline even on a fast server. The auto-select effect below promotes
    // the first unknown 'shell' that arrives.
    lastShellSnapshotRef.current = new Set(featureTerminals.map((t) => t.id))
    startTerminal({
      profileId: DEFAULT_TERMINAL_PROFILE,
      planetId: planet.id,
      featureId: feature.id,
      cwd,
      role: 'shell',
    })
  }

  const closeTab = (tab: FeatureTab) => {
    if (!tab.terminal) return // placeholder leader — nothing on the server yet
    // If we just removed the active tab, clear the selection so the workspace
    // falls back to the leader on the next render.
    if (selectedId === tab.key) selectFeatureTab(feature.id, null)
    deleteTerminal(tab.terminal.id)
  }

  // Auto-select newly spawned shells so the user lands in them immediately.
  const lastShellSnapshotRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    const known = lastShellSnapshotRef.current
    if (!known) return
    const fresh = featureTerminals.find((t) => !known.has(t.id) && t.role === 'shell')
    if (fresh) {
      lastShellSnapshotRef.current = null
      selectFeatureTab(feature.id, fresh.id)
    }
  }, [featureTerminals, feature.id, selectFeatureTab])

  if (!planet.pathExists) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
        <EmptyMessage>
          project path is missing on disk — restore the path or delete the project.
        </EmptyMessage>
      </div>
    )
  }

  const branchTag = feature.branch ? ` · ${feature.branch}` : ''

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="border-b border-cyan-500/30 px-2 py-1 flex items-center gap-1 text-xs shrink-0 overflow-x-auto">
        {tabs.map((tab) => (
          <FeatureTabButton
            key={tab.key}
            tab={tab}
            active={activeTab.key === tab.key}
            onClick={() => selectFeatureTab(feature.id, tab.key)}
            onClose={tab.terminal ? () => closeTab(tab) : undefined}
          />
        ))}
        <button
          type="button"
          onClick={spawnShell}
          disabled={!connected}
          className="ml-1 px-2 py-0.5 text-[10px] tracking-widest text-sky-300 border border-sky-400/30 rounded hover:border-sky-300 disabled:opacity-40"
          title="spawn a new shell in the worktree"
        >
          + SHELL
        </button>
        <span className="ml-auto text-[10px] text-slate-500 truncate pl-2">
          {feature.chatName ?? feature.name}
          {branchTag}
        </span>
      </div>
      <div className="flex-1 relative">
        {activeTab.role === 'leader' ? (
          <ScopedPrimaryTerminal
            title="LEADER"
            subtitle={`${feature.chatName ?? feature.name}${branchTag}`}
            scope={{ planetId: planet.id, featureId: feature.id, role: 'leader' }}
            spawnReq={leaderSpawnReq}
            available={planet.pathExists}
            unavailableMessage="project path is missing on disk."
          />
        ) : activeTab.terminal ? (
          <TerminalPanel sessionId={activeTab.terminal.id} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <EmptyMessage>terminal gone — pick another tab.</EmptyMessage>
          </div>
        )}
      </div>
    </div>
  )
}

interface FeatureTab {
  /** Stable identity used by `selectedTabByFeature`. Either a real session
   *  id, or `__leader_placeholder__` when the leader hasn't spawned yet. */
  key: string
  label: string
  role: string
  terminal: TerminalSessionDescriptor | null
}

const TAB_STATE_DOT: Record<TerminalSessionDescriptor['state'], string> = {
  running: 'bg-sky-400',
  exited: 'bg-slate-500',
  killed: 'bg-rose-400',
  failed: 'bg-rose-500',
  runtime_lost: 'bg-amber-300',
}

function FeatureTabButton({
  tab,
  active,
  onClick,
  onClose,
}: {
  tab: FeatureTab
  active: boolean
  onClick: () => void
  /** When present, renders a × that closes the tab. The placeholder leader
   *  tab gets none — there's nothing to delete until it spawns. */
  onClose?: () => void
}) {
  const dotClass = tab.terminal ? TAB_STATE_DOT[tab.terminal.state] : 'bg-slate-600'
  return (
    <span
      className={`px-2 py-1 text-[10px] tracking-widest rounded border transition-colors flex items-center gap-2 ${
        active
          ? 'border-cyan-300 text-cyan-200 bg-cyan-400/10'
          : 'border-cyan-400/20 text-slate-300 hover:border-cyan-300/50 hover:text-cyan-100'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-2"
      >
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} />
        {tab.label}
      </button>
      {onClose && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="text-slate-500 hover:text-rose-300"
          title={
            tab.role === 'leader'
              ? 'kill leader (will respawn)'
              : 'kill and remove'
          }
        >
          ×
        </button>
      )}
    </span>
  )
}

function ChatOrTerminal({
  planet,
  featureId,
}: {
  planet: PlanetSummary
  featureId?: number
}) {
  const selectedTerminalId = useUiStore(
    (s) => s.selectedTerminalByPlanet[planet.id] ?? null,
  )
  const selectTerminal = useUiStore((s) => s.selectTerminal)
  const terminals = useTerminalsByPlanet(planet.id)
  const terminal = selectedTerminalId
    ? (terminals.find((t) => t.id === selectedTerminalId) ?? null)
    : null
  const features = useFeaturesMap()
  const feature =
    featureId !== undefined
      ? (features.get(planet.id) ?? []).find((f) => f.id === featureId) ?? null
      : null

  // User picked a specific terminal in the TERMS tab → always wins.
  if (selectedTerminalId && terminal) {
    return (
      <div className="flex flex-col h-full text-sm">
        <TerminalHeader
          title="TERMINAL"
          subtitle={terminal.id}
          onClose={() => selectTerminal(planet.id, null)}
        />
        <div className="flex-1 relative">
          <TerminalPanel sessionId={terminal.id} />
        </div>
      </div>
    )
  }

  // LOD 1 ambient → planet primary terminal.
  if (featureId === undefined) {
    return <PrimaryPlanetTerminal planet={planet} />
  }

  // LOD 2 → feature workspace with tabs (leader + shells + any role the
  // workflow engine has spawned).
  if (feature) {
    return <FeatureWorkspace planet={planet} feature={feature} />
  }

  // Feature row not yet hydrated — show a neutral placeholder rather than
  // flashing the old chat body.
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
      <EmptyMessage>loading feature…</EmptyMessage>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ShipInfoPanel — left panel content at LOD 2
// ---------------------------------------------------------------------------

function ShipInfoPanel({ feature }: { feature: FeatureSummary }) {
  const [markingDone, setMarkingDone] = useState(false)
  const [handoffTarget, setHandoffTarget] = useState<FeatureSummary | null>(null)

  const handleMarkDone = async () => {
    setMarkingDone(true)
    const res = await apiPost(`/api/features/${feature.id}/done`)
    setMarkingDone(false)
    if (res.ok) {
      pushToast('success', 'Feature marked as done.')
    } else {
      pushToast('error', `Couldn't mark done: ${res.error}`)
    }
  }

  return (
    <>
      {handoffTarget && (
        <HandoffDialog
          planetId={feature.planetId}
          feature={handoffTarget}
          onClose={() => setHandoffTarget(null)}
        />
      )}
      <div className="text-xs tracking-widest text-slate-400">FEATURE</div>
      <h3 className="text-sky-100 text-lg mt-1">{feature.chatName ?? feature.name}</h3>
      {feature.description !== null ? (
        <p className="text-sm text-slate-300 mt-2 whitespace-pre-wrap">{feature.description}</p>
      ) : (
        <p className="text-sm text-slate-500 mt-2 italic">Generating description…</p>
      )}

      {feature.task && (
        <>
          <div className="text-xs tracking-widest text-slate-400 mt-4">TASK</div>
          <p className="text-sm text-slate-300 mt-1 whitespace-pre-wrap">{feature.task}</p>
        </>
      )}

      {feature.status !== 'done' && feature.status !== 'complete' && (
        <div className="mt-4 flex gap-2">
          <GlassButton
            variant="ghost"
            className="text-xs"
            onClick={() => void handleMarkDone()}
            disabled={markingDone}
          >
            {markingDone ? 'marking…' : '✓ Mark done'}
          </GlassButton>
          <GlassButton
            variant="ghost"
            className="text-xs"
            onClick={() => setHandoffTarget(feature)}
          >
            hand off
          </GlassButton>
        </div>
      )}

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
// NotificationsTab
// ---------------------------------------------------------------------------

function NotificationsTab() {
  const rows = useNotificationRows()
  const focusShip = useUiStore((s) => s.focusShip)

  if (rows.length === 0) {
    return <EmptyMessage>no pending clarifications</EmptyMessage>
  }
  return (
    <ul className="space-y-2 overflow-y-auto">
      {rows.map((r) => (
        <li
          key={r.agentSessionId}
          className="border border-amber-300/20 rounded p-2 cursor-pointer hover:bg-amber-300/5"
          onClick={() => focusShip(r.planetId, r.shipFeatureId)}
        >
          <div className="text-sky-300 text-xs">
            {r.planetName} · {r.featureName}
          </div>
          <p className="text-slate-300 text-sm mt-0.5">{r.question}</p>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// InfoPanelBody
// ---------------------------------------------------------------------------

function usePlanetSync(planetId: number) {
  const setPlanetFeatures = useSocketStore((s) => s.setPlanetFeatures)

  const sync = useCallback(() => {
    void apiPost<FeatureSummary[]>(`/api/planets/${planetId}/sync`).then((res) => {
      if (res.ok) setPlanetFeatures(planetId, res.data)
    })
  }, [planetId, setPlanetFeatures])

  // Sync once when the planet panel opens or the planet changes.
  useEffect(() => {
    sync()
  }, [sync])

  return sync
}

function InfoPanelBody({ planet }: { planet: PlanetSummary }) {
  const features = useFeaturesMap().get(planet.id) ?? []
  const tab = useUiStore((s) => s.infoTab)
  const setTab = useUiStore((s) => s.openInfoTab)
  const hasRunning = features.some((f) => f.status === 'running')
  const notifCount = useNotificationRows().length
  const sync = usePlanetSync(planet.id)

  function switchTab(t: typeof tab) {
    sync()
    setTab(t)
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        <GlassTab active={tab === 'features'} onClick={() => switchTab('features')}>
          FEATURES
        </GlassTab>
        <GlassTab active={tab === 'tools'} onClick={() => switchTab('tools')}>
          TOOLS
        </GlassTab>
        <GlassTab active={tab === 'plans'} onClick={() => switchTab('plans')}>
          PLANS
        </GlassTab>
        <GlassTab active={tab === 'description'} onClick={() => switchTab('description')}>
          DESC
        </GlassTab>
        {hasRunning && (
          <GlassTab active={tab === 'run'} onClick={() => switchTab('run')}>
            RUN
          </GlassTab>
        )}
        <GlassTab active={tab === 'notifications'} onClick={() => switchTab('notifications')}>
          INBOX{notifCount > 0 ? ` · ${notifCount}` : ''}
        </GlassTab>
        <GlassTab active={tab === 'handoffs'} onClick={() => switchTab('handoffs')}>
          HANDOFFS
        </GlassTab>
        <GlassTab active={tab === 'terminals'} onClick={() => switchTab('terminals')}>
          TERMS
        </GlassTab>
      </div>
      {tab === 'features' && <FeaturesTab features={features} planetId={planet.id} />}
      {tab === 'tools' && <ToolsTabContent planetId={planet.id} />}
      {tab === 'plans' && <PlansTab features={features} />}
      {tab === 'description' && (
        <DescriptionTab planetId={planet.id} projectPath={planet.projectPath} />
      )}
      {tab === 'run' && <RunTabContent planetId={planet.id} features={features} />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'handoffs' && <HandoffsTab planetId={planet.id} />}
      {tab === 'terminals' && <TerminalsTab planet={planet} />}
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
  const infoPanelOpen = useUiStore((s) => s.infoPanelOpen)
  const chatPanelOpen = useUiStore((s) => s.chatPanelOpen)
  const setInfoPanelOpen = useUiStore((s) => s.setInfoPanelOpen)
  const setChatPanelOpen = useUiStore((s) => s.setChatPanelOpen)
  const planets = usePlanets()
  const features = useFeaturesMap()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

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

  const [wfOpen, setWfOpen] = useState(false)

  const isSunFocus = focus.lod === 1 && 'sun' in focus && focus.sun === true

  if (!isSunFocus && !planet) return null

  // When the sun is focused there's no chat session — keep legacy single-panel layout.
  // For planet/ship focus, panel visibility is now user-toggleable:
  //   both open  → 50/50 split with draggable splitter (default)
  //   info only  → info on the left at ~splitter width; right half clickable through to scene
  //   chat only  → chat on the right at ~(1 - splitter) width; left half clickable through
  //   both closed → no panels; corner icons (rendered by PanelToggleIcons) restore them
  // The splitter is shown whenever any side panel is visible (not just both),
  // so the user can resize the single-open panel too.
  const showSplitter = !isSunFocus && (infoPanelOpen || chatPanelOpen)

  // Outside-click "close both panels" semantics live on the R3F <Canvas>
  // via onPointerMissed — that way clicking a ship/drone in the visible
  // 3D area still goes to the 3D handler, and only clicks on empty space
  // close the panels. See App.tsx.
  return (
    <>
      <div className="absolute inset-0 p-4 pointer-events-none">
        {/* Top bar (always visible while focused; carries the hide-all eye button). */}
        <GlassPanel className="flex items-center justify-between px-4 py-2 mb-3 pointer-events-auto">
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
            <GlassButton variant="ghost" onClick={() => setWfOpen(true)}>⚙ workflow editor</GlassButton>
            {!isSunFocus && (
              confirmingDelete ? (
                <>
                  <GlassButton variant="ghost" onClick={() => setConfirmingDelete(false)}>cancel</GlassButton>
                  <GlassButton variant="danger" onClick={async () => {
                    setConfirmingDelete(false)
                    back()
                    const res = await apiDelete(`/api/planets/${planet!.id}`)
                    if (!res.ok) pushToast('error', `delete failed: ${res.error}`)
                  }}>confirm delete</GlassButton>
                </>
              ) : (
                <GlassButton variant="danger" onClick={() => setConfirmingDelete(true)}>✕ delete</GlassButton>
              )
            )}
          </div>
        </GlassPanel>

        {/* Body */}
        {isSunFocus ? (
          <div className="relative pointer-events-auto" style={{ height: 'calc(100% - 80px)' }}>
            <div className="absolute inset-0 p-2">
              <GlassPanel className="h-full p-4 overflow-hidden flex flex-col">
                <SunPanelInfo />
              </GlassPanel>
            </div>
          </div>
        ) : (
          <div className="relative" style={{ height: 'calc(100% - 80px)' }}>
            {infoPanelOpen && (
              <div
                className="absolute inset-y-0 left-0 p-2 pointer-events-auto"
                style={{ width: `${splitterRatio * 100}%` }}
              >
                <GlassPanel className="h-full p-4 overflow-y-auto relative">
                  <MinimizeButton onClick={() => setInfoPanelOpen(false)} title="hide info panel" />
                  {focus.lod === 2 && focusedFeature ? (
                    <ShipInfoPanel feature={focusedFeature} />
                  ) : (
                    <InfoPanelBody planet={planet!} />
                  )}
                </GlassPanel>
              </div>
            )}

            {showSplitter && (
              <div className="pointer-events-auto">
                {/*
                  Three splitter positions to support:
                    both open  → handle at splitterRatio (between panels)
                    info-only  → handle at splitterRatio (right edge of info)
                    chat-only  → handle at (1 - splitterRatio) (left edge of chat).
                                 In this mode the splitter's value is the
                                 *chat-left position*, so we invert when
                                 mapping back to splitterRatio (=info width).
                */}
                {!infoPanelOpen && chatPanelOpen ? (
                  <GlassSplitter
                    ratio={1 - splitterRatio}
                    onChange={(next) => setSplitterRatio(1 - next)}
                  />
                ) : (
                  <GlassSplitter ratio={splitterRatio} onChange={setSplitterRatio} />
                )}
              </div>
            )}

            {chatPanelOpen && (
              <div
                className="absolute inset-y-0 right-0 p-2 pointer-events-auto"
                style={{
                  // When info is also open, chat starts at info's right edge
                  // (splitterRatio). When chat is alone, it sits on the right
                  // at width = splitterRatio, so its left = 1 - splitterRatio.
                  left: infoPanelOpen
                    ? `${splitterRatio * 100}%`
                    : `${(1 - splitterRatio) * 100}%`,
                  paddingLeft: 12,
                }}
              >
                <GlassPanel className="h-full p-4 overflow-hidden relative">
                  <MinimizeButton onClick={() => setChatPanelOpen(false)} title="hide chat panel" />
                  <ChatOrTerminal
                    planet={planet!}
                    featureId={focus.lod === 2 ? focus.shipFeatureId : undefined}
                  />
                </GlassPanel>
              </div>
            )}
          </div>
        )}

        <WorkflowEditorOverlay open={wfOpen} onClose={() => setWfOpen(false)} />
      </div>
    </>
  )
}

/**
 * Small glass minimize chip docked in the top-right of a side panel.
 * Closes that panel only; the corresponding corner-icon set
 * (PanelToggleIcons) becomes the way to reopen it.
 */
function MinimizeButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={onClick}
      className="glass-chip absolute top-2 right-2 z-10 cursor-pointer hover:brightness-125 transition"
      style={{ padding: '2px 8px', fontSize: 12, lineHeight: 1 }}
    >
      —
    </button>
  )
}

