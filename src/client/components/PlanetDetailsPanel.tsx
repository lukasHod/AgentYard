import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  FeatureSummary,
  SessionDescriptor,
  PlanetSummary,
} from '../../core/types'
import { apiGet, apiPost } from '../api'
import { pushToast } from '../state/toastStore'
import { AgentChat, type AgentChatMessage, type AgentChatPending } from './AgentChat'
import { ToolsTabContent } from './ToolsTabContent'
import { EmptyMessage } from './ui/EmptyMessage'

export type PlanetPanelTab = 'features' | 'tools' | 'plans' | 'description' | 'chat'

interface PlanetDescriptionData {
  readme: string | null
  readmePath: string | null
  git: { branch?: string; head?: { sha: string; subject: string } }
  projectPath: string
  pathExists: boolean
}

interface Props {
  planet: PlanetSummary
  features: FeatureSummary[]
  sessions: SessionDescriptor[]
  transcripts: Map<string, AgentChatMessage[]>
  pendings: Map<string, AgentChatPending>
  connected: boolean
  /** Controlled tab. Pass undefined for internal state. */
  tab?: PlanetPanelTab
  onTabChange?: (tab: PlanetPanelTab) => void
  onSend: (agentRunId: string, content: string) => void
  onClarificationReply: (agentRunId: string, toolUseId: string, answer: string) => void
  onNewFeature: () => void
  onOpenWorkflow: () => void
  onDeletePlanet: () => void
}

const TABS: Array<{ id: PlanetPanelTab; label: string }> = [
  { id: 'features', label: 'features' },
  { id: 'tools', label: 'tools' },
  { id: 'plans', label: 'plans' },
  { id: 'description', label: 'description' },
  { id: 'chat', label: 'chat' },
]

export function PlanetDetailsPanel(props: Props) {
  const {
    planet,
    features,
    sessions,
    transcripts,
    pendings,
    connected,
    tab: controlledTab,
    onTabChange,
    onSend,
    onClarificationReply,
    onNewFeature,
    onOpenWorkflow,
    onDeletePlanet,
  } = props

  const [internalTab, setInternalTab] = useState<PlanetPanelTab>('features')
  const tab = controlledTab ?? internalTab
  const setTab = (t: PlanetPanelTab) => {
    setInternalTab(t)
    onTabChange?.(t)
  }

  const [description, setDescription] = useState<PlanetDescriptionData | null>(null)

  // Reset description when planet changes.
  useEffect(() => {
    setDescription(null)
  }, [planet.id])

  useEffect(() => {
    if (tab !== 'description' || description !== null) return
    // Abort in-flight fetches when the user clicks between planets quickly so
    // a stale response can't overwrite a newer one.
    const controller = new AbortController()
    void apiGet<PlanetDescriptionData>(`/api/planets/${planet.id}/description`, {
      signal: controller.signal,
    }).then((res) => {
      if (controller.signal.aborted) return
      if (res.ok) {
        setDescription(res.data)
      } else if (!res.aborted) {
        setDescription({
          readme: null,
          readmePath: null,
          git: {},
          projectPath: planet.projectPath,
          pathExists: false,
        })
      }
    })
    return () => controller.abort()
    // Tools tab self-fetches (see ToolsTabContent); no work here.
  }, [tab, description, planet.id, planet.projectPath])

  const runningFeature = features.find((f) => f.status === 'running')

  // The chat tab is anchored to a long-lived planet-chat session identified by
  // the label `planet:<id>:chat` — NOT the transient feature-run leader. The
  // session is created lazily the first time the user opens the chat for this
  // planet and persists across tab/planet switches until the planet is deleted.
  const chatLabel = `planet:${planet.id}:chat`
  const chatSession = useMemo(
    () => sessions.find((s) => s.label === chatLabel),
    [sessions, chatLabel],
  )

  const [chatOpening, setChatOpening] = useState(false)
  // A prior failure inhibits the auto-open useEffect from spinning indefinitely
  // — the user can still hit the manual retry button to clear it.
  const [chatOpenError, setChatOpenError] = useState<string | null>(null)
  const openChat = useCallback(async () => {
    setChatOpening(true)
    setChatOpenError(null)
    const res = await apiPost(`/api/planets/${planet.id}/chat/open`)
    setChatOpening(false)
    if (!res.ok) {
      setChatOpenError(res.error)
      pushToast('error', `Couldn't open chat: ${res.error}`)
    }
    // On success the server emits `session:added` which lands in the store and
    // the panel re-renders with `chatSession` populated.
  }, [planet.id])

  // Reset the cached error when the user switches planets so the next planet's
  // chat tab gets a fresh auto-open attempt.
  useEffect(() => {
    setChatOpenError(null)
  }, [planet.id])

  // Auto-open the chat the moment the user switches to the CHAT tab. Gated
  // on: no live session yet, not already opening, no prior failure, socket
  // connected, project path exists on disk. The manual button is preserved
  // as a retry path for the error case.
  useEffect(() => {
    if (tab !== 'chat') return
    if (chatSession) return
    if (chatOpening) return
    if (chatOpenError !== null) return
    if (!connected) return
    if (!planet.pathExists) return
    void openChat()
  }, [
    tab,
    chatSession,
    chatOpening,
    chatOpenError,
    connected,
    planet.pathExists,
    openChat,
  ])

  const chatBadge = chatSession && pendings.get(chatSession.id) ? '●' : null

  return (
    <div className="flex flex-col h-full text-xs">
      <header className="border-b border-cyan-500/40 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-cyan-300 tracking-widest truncate">PLANET / {planet.name.toUpperCase()}</h2>
          <div className="flex items-center gap-2 shrink-0">
            {runningFeature && (
              <span className="text-cyan-300 text-[10px] animate-pulse">● {runningFeature.name}</span>
            )}
            <button
              onClick={() => {
                if (
                  confirm(
                    `Delete project "${planet.name}"? This removes the project + feature records from AgentYard. Worktrees on disk are left in place.`,
                  )
                ) {
                  onDeletePlanet()
                }
              }}
              title="delete project"
              className="text-zinc-500 hover:text-rose-300 text-sm leading-none px-1"
            >
              ✕
            </button>
          </div>
        </div>
        <p className="text-[10px] text-zinc-500 font-mono mt-0.5 break-all">{planet.projectPath}</p>
      </header>

      <nav className="flex items-center flex-wrap gap-2 border-b border-cyan-500/20 px-3 py-3">
        {TABS.map((t) => {
          const active = t.id === tab
          const showBadge = t.id === 'chat' && chatBadge
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1 border text-[10px] tracking-widest flex items-center gap-1 transition-colors ${
                active
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                  : 'border-cyan-500/50 text-cyan-300 hover:border-cyan-400 hover:bg-cyan-500/10'
              }`}
            >
              {t.label.toUpperCase()}
              {showBadge && <span className="text-amber-300 animate-pulse">{chatBadge}</span>}
            </button>
          )
        })}
      </nav>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'features' && (
          <div className="h-full overflow-y-auto p-3">
            <FeaturesTab
              features={features}
              onNewFeature={onNewFeature}
              onOpenWorkflow={onOpenWorkflow}
            />
          </div>
        )}
        {tab === 'tools' && (
          <div className="h-full overflow-y-auto p-3">
            <ToolsTabContent planetId={planet.id} />
          </div>
        )}
        {tab === 'plans' && (
          <div className="h-full overflow-y-auto p-3">
            <PlansTab features={features} />
          </div>
        )}
        {tab === 'description' && (
          <div className="h-full overflow-y-auto p-3">
            <DescriptionTab data={description} />
          </div>
        )}
        {tab === 'chat' && (
          <div className="h-full min-h-0">
            {chatSession ? (
              <AgentChat
                agentRunId={chatSession.id}
                label={planet.name}
                role={chatSession.role}
                state={chatSession.state}
                transcript={transcripts.get(chatSession.id) ?? []}
                pending={pendings.get(chatSession.id) ?? null}
                connected={connected}
                onSend={(c) => onSend(chatSession.id, c)}
                onReply={(t, a) => onClarificationReply(chatSession.id, t, a)}
              />
            ) : chatOpening ? (
              <div className="h-full flex items-center justify-center p-4">
                <span className="text-cyan-300 text-xs tracking-widest animate-pulse">
                  ◌ opening chat…
                </span>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
                <EmptyMessage>
                  {chatOpenError
                    ? `couldn't open chat: ${chatOpenError}`
                    : !planet.pathExists
                      ? 'project path is missing on disk — restore the path or delete the project.'
                      : !connected
                        ? 'offline — reconnect to the server to open the chat.'
                        : 'no chat yet.'}
                </EmptyMessage>
                <button
                  onClick={openChat}
                  disabled={chatOpening || !connected || !planet.pathExists}
                  className="px-3 py-1 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black tracking-wide disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {chatOpenError ? '⟳ retry' : '▶ open chat'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function FeaturesTab({
  features,
  onNewFeature,
  onOpenWorkflow,
}: {
  features: FeatureSummary[]
  onNewFeature: () => void
  onOpenWorkflow: () => void
}) {
  return (
    <>
      <div className="flex gap-2 mb-3">
        <button
          onClick={onNewFeature}
          className="px-3 py-1 border border-fuchsia-500 text-fuchsia-300 hover:bg-fuchsia-500 hover:text-black tracking-wide"
        >
          ▶ new feature
        </button>
        <button
          onClick={onOpenWorkflow}
          className="px-3 py-1 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black tracking-wide"
        >
          ⚙ workflow editor
        </button>
      </div>
      {features.length === 0 ? (
        <EmptyMessage>no features yet</EmptyMessage>
      ) : (
        <ul className="space-y-2">
          {features.map((f) => (
            <li key={f.id} className="border border-cyan-500/20 rounded p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-cyan-300 truncate">{f.name}</span>
                <span
                  className={`text-[10px] tracking-widest ${
                    f.status === 'running'
                      ? 'text-cyan-300'
                      : f.status === 'complete'
                        ? 'text-emerald-300'
                        : f.status === 'failed'
                          ? 'text-rose-400'
                          : 'text-zinc-500'
                  }`}
                >
                  {f.status}
                </span>
              </div>
              <p className="text-zinc-300 mt-1 whitespace-pre-wrap line-clamp-2">{f.task}</p>
              {f.branch && (
                <p className="text-[10px] text-zinc-500 mt-1 font-mono truncate">{f.branch}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function PlansTab({ features }: { features: FeatureSummary[] }) {
  if (features.length === 0) {
    return (
      <EmptyMessage>no plans recorded yet. each feature run records its task + summary here.</EmptyMessage>
    )
  }
  return (
    <ul className="space-y-3">
      {features.map((f) => (
        <li key={f.id} className="border border-cyan-500/15 rounded p-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-cyan-300">{f.name}</span>
            <span className="text-[10px] text-zinc-500">{new Date(f.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="mt-1 text-[10px] tracking-widest text-zinc-500">TASK</div>
          <p className="text-zinc-200 whitespace-pre-wrap">{f.task}</p>
          {f.finalSummary && (
            <>
              <div className="mt-2 text-[10px] tracking-widest text-emerald-300">OUTCOME</div>
              <p className="text-zinc-200 whitespace-pre-wrap">{f.finalSummary}</p>
            </>
          )}
          {f.error && (
            <>
              <div className="mt-2 text-[10px] tracking-widest text-rose-400">ERROR</div>
              <p className="text-rose-300 whitespace-pre-wrap">{f.error}</p>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

function DescriptionTab({ data }: { data: PlanetDescriptionData | null }) {
  if (data === null) return <EmptyMessage>loading...</EmptyMessage>
  return (
    <div className="space-y-3">
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
        <h3 className="text-[10px] tracking-widest text-zinc-500">PROJECT PATH</h3>
        <p className="text-zinc-300 font-mono break-all">{data.projectPath}</p>
      </section>
      <section className="space-y-1">
        <h3 className="text-[10px] tracking-widest text-zinc-500">GIT</h3>
        {data.git.branch ? (
          <>
            <p className="text-zinc-300">
              branch: <span className="text-cyan-300 font-mono">{data.git.branch}</span>
            </p>
            {data.git.head && (
              <p className="text-zinc-300">
                head: <span className="text-cyan-300 font-mono">{data.git.head.sha}</span>{' '}
                <span className="text-zinc-400">— {data.git.head.subject}</span>
              </p>
            )}
          </>
        ) : (
          <EmptyMessage>no git info</EmptyMessage>
        )}
      </section>
      <section className="space-y-1">
        <h3 className="text-[10px] tracking-widest text-zinc-500">
          README {data.readmePath && <span className="text-zinc-400">({data.readmePath})</span>}
        </h3>
        {data.readme === null ? (
          <EmptyMessage>no README found at repo root</EmptyMessage>
        ) : (
          <pre className="text-zinc-200 whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-zinc-950 border border-cyan-500/15 rounded p-2 overflow-x-auto max-h-96 overflow-y-auto">
            {data.readme}
          </pre>
        )}
      </section>
    </div>
  )
}
