import { useEffect, useMemo, useState } from 'react'
import type {
  FeatureSummary,
  SessionDescriptor,
  ShipSummary,
} from '../../core/types'
import { AgentChat, type AgentChatMessage, type AgentChatPending } from './AgentChat'
import { ToolsTabContent } from './ToolsTabContent'

export type ShipPanelTab = 'features' | 'tools' | 'plans' | 'description' | 'chat'

interface SkillSummary {
  name: string
  description: string
  path: string
}

interface ShipDescriptionData {
  readme: string | null
  readmePath: string | null
  git: { branch?: string; head?: { sha: string; subject: string } }
  projectPath: string
  pathExists: boolean
}

interface Props {
  ship: ShipSummary
  features: FeatureSummary[]
  sessions: SessionDescriptor[]
  transcripts: Map<string, AgentChatMessage[]>
  pendings: Map<string, AgentChatPending>
  skills: SkillSummary[]
  connected: boolean
  /** Controlled tab. Pass undefined for internal state. */
  tab?: ShipPanelTab
  onTabChange?: (tab: ShipPanelTab) => void
  onSend: (agentRunId: string, content: string) => void
  onClarificationReply: (agentRunId: string, toolUseId: string, answer: string) => void
  onNewFeature: () => void
  onOpenWorkflow: () => void
  onDeleteShip: () => void
}

const TABS: Array<{ id: ShipPanelTab; label: string }> = [
  { id: 'features', label: 'features' },
  { id: 'tools', label: 'tools' },
  { id: 'plans', label: 'plans' },
  { id: 'description', label: 'description' },
  { id: 'chat', label: 'chat' },
]

export function ShipDetailsPanel(props: Props) {
  const {
    ship,
    features,
    sessions,
    transcripts,
    pendings,
    skills,
    connected,
    tab: controlledTab,
    onTabChange,
    onSend,
    onClarificationReply,
    onNewFeature,
    onOpenWorkflow,
    onDeleteShip,
  } = props

  const [internalTab, setInternalTab] = useState<ShipPanelTab>('features')
  const tab = controlledTab ?? internalTab
  const setTab = (t: ShipPanelTab) => {
    setInternalTab(t)
    onTabChange?.(t)
  }

  const [description, setDescription] = useState<ShipDescriptionData | null>(null)

  // Reset description when ship changes.
  useEffect(() => {
    setDescription(null)
  }, [ship.id])

  useEffect(() => {
    if (tab === 'description' && description === null) {
      fetch(`/api/ships/${ship.id}/description`)
        .then((r) => r.json())
        .then(setDescription)
        .catch(() =>
          setDescription({
            readme: null,
            readmePath: null,
            git: {},
            projectPath: ship.projectPath,
            pathExists: false,
          }),
        )
    }
    // Tools tab self-fetches (see ToolsTabContent); no work here.
  }, [tab, description, ship.id, ship.projectPath])

  const runningFeature = features.find((f) => f.status === 'running')
  const leader = useMemo(
    () => (runningFeature ? sessions.find((s) => s.role === 'leader') : undefined),
    [runningFeature, sessions],
  )

  const chatBadge = leader && pendings.get(leader.id) ? '●' : null

  return (
    <div className="flex flex-col h-full text-xs">
      <header className="border-b border-cyan-500/40 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-cyan-300 tracking-widest truncate">SHIP / {ship.name.toUpperCase()}</h2>
          <div className="flex items-center gap-2 shrink-0">
            {runningFeature && (
              <span className="text-cyan-300 text-[10px] animate-pulse">● {runningFeature.name}</span>
            )}
            <button
              onClick={() => {
                if (
                  confirm(
                    `Delete ship "${ship.name}"? This removes the ship + feature records from AgentYard. Worktrees on disk are left in place.`,
                  )
                ) {
                  onDeleteShip()
                }
              }}
              title="delete ship"
              className="text-zinc-500 hover:text-rose-300 text-sm leading-none px-1"
            >
              ✕
            </button>
          </div>
        </div>
        <p className="text-[10px] text-zinc-500 font-mono mt-0.5 break-all">{ship.projectPath}</p>
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
            <ToolsTabContent shipId={ship.id} />
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
            {leader ? (
              <AgentChat
                agentRunId={leader.id}
                label={leader.label ?? 'leader'}
                role={leader.role}
                state={leader.state}
                transcript={transcripts.get(leader.id) ?? []}
                pending={pendings.get(leader.id) ?? null}
                connected={connected}
                onSend={(c) => onSend(leader.id, c)}
                onReply={(t, a) => onClarificationReply(leader.id, t, a)}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-600 italic p-4 text-center">
                // no active leader for this ship. start a new feature to bring one online.
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
        <p className="text-zinc-600 italic">// no features yet</p>
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
      <p className="text-zinc-600 italic">
        // no plans recorded yet. each feature run records its task + summary here.
      </p>
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

function DescriptionTab({ data }: { data: ShipDescriptionData | null }) {
  if (data === null) return <p className="text-zinc-600 italic">// loading...</p>
  return (
    <div className="space-y-3">
      {!data.pathExists && (
        <div className="border border-rose-400/60 bg-rose-500/10 rounded p-2 text-rose-200">
          <div className="text-[10px] tracking-widest text-rose-300 mb-0.5">PATH MISSING</div>
          <p>
            The project path no longer exists on disk. Worktree creation and feature runs will fail
            until the path is restored or the ship is deleted (use the ✕ in the header).
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
          <p className="text-zinc-600 italic">// no git info</p>
        )}
      </section>
      <section className="space-y-1">
        <h3 className="text-[10px] tracking-widest text-zinc-500">
          README {data.readmePath && <span className="text-zinc-400">({data.readmePath})</span>}
        </h3>
        {data.readme === null ? (
          <p className="text-zinc-600 italic">// no README found at repo root</p>
        ) : (
          <pre className="text-zinc-200 whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-zinc-950 border border-cyan-500/15 rounded p-2 overflow-x-auto max-h-96 overflow-y-auto">
            {data.readme}
          </pre>
        )}
      </section>
    </div>
  )
}
