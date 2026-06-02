import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { ToolScope, ToolSummary, ToolType } from '../../core/tools'
import { apiDelete, apiGet, apiPost, type ApiResult } from '../api'
import { pushToast } from '../state/toastStore'
import type { AnyToolData, EditorMode } from './tools/ToolEditorModal'
import { EmptyMessage } from './ui/EmptyMessage'

const ToolEditorModal = lazy(() =>
  import('./tools/ToolEditorModal').then((m) => ({ default: m.ToolEditorModal })),
)

interface Props {
  /** Null when used in the galaxy library view — list endpoint switches to /api/global-tools. */
  planetId: number | null
}

interface CLIInfo {
  name: string
  available: boolean
  version: string | null
}

const TYPE_ORDER: ToolType[] = ['skill', 'agent', 'mcp', 'script']

const TYPE_LABEL: Record<ToolType, string> = {
  skill: 'SKILLS',
  agent: 'AGENTS',
  mcp: 'MCPS',
  script: 'SCRIPTS',
}

const SCOPE_LABEL: Record<ToolScope, string> = {
  planet: 'agentyard',
  global: 'global',
  'claude-project': '.claude project',
  'claude-user': '.claude user',
}

const SCOPE_CLASS: Record<ToolScope, string> = {
  planet: 'border-cyan-500/60 text-cyan-200',
  global: 'border-emerald-500/60 text-emerald-200',
  'claude-project': 'border-zinc-500/60 text-zinc-300',
  'claude-user': 'border-zinc-500/60 text-zinc-300',
}

export function ToolsTabContent({ planetId }: Props) {
  const [tools, setTools] = useState<ToolSummary[] | null>(null)
  const [clis, setClis] = useState<CLIInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // key of tool currently performing an action
  const [editor, setEditor] = useState<EditorMode | null>(null)

  const refetch = useCallback(async () => {
    const url = planetId === null ? '/api/global-tools' : `/api/planets/${planetId}/tools`
    const res = await apiGet<ToolSummary[]>(url)
    if (res.ok) {
      setTools(res.data)
      setError(null)
    } else {
      setError(res.error)
    }
  }, [planetId])

  useEffect(() => {
    void refetch()
    if (clis === null) {
      void apiGet<CLIInfo[]>('/api/clis').then((r) => setClis(r.ok ? r.data : []))
    }
  }, [planetId, refetch, clis])

  // Group by type, preserving the order in TYPE_ORDER.
  const byType = useMemo(() => {
    const m: Record<ToolType, ToolSummary[]> = { skill: [], agent: [], mcp: [], script: [] }
    for (const t of tools ?? []) m[t.type].push(t)
    return m
  }, [tools])

  const keyOf = (t: ToolSummary) => `${t.scope}/${t.type}/${t.name}`

  async function runAction(label: string, fn: () => Promise<ApiResult<unknown>>) {
    setBusy(label)
    const res = await fn()
    if (!res.ok) pushToast('error', `Failed: ${res.error}`)
    await refetch()
    setBusy(null)
  }

  function adopt(t: ToolSummary, target: 'planet' | 'global') {
    if (target === 'planet' && planetId === null) return
    void runAction(keyOf(t), () => {
      // In galaxy library view: only claude-user → global is supported, via a different endpoint.
      if (planetId === null) {
        return apiPost(`/api/global-tools/adopt`, { type: t.type, name: t.name })
      }
      return apiPost(`/api/planets/${planetId}/tools/adopt`, {
        sourceScope: t.scope,
        type: t.type,
        name: t.name,
        target,
      })
    })
  }

  function elevate(t: ToolSummary) {
    if (planetId === null) return
    void runAction(keyOf(t), () =>
      apiPost(`/api/planets/${planetId}/tools/${t.type}/${t.name}/elevate`),
    )
  }

  function fork(t: ToolSummary) {
    if (planetId === null) return
    void runAction(keyOf(t), () =>
      apiPost(`/api/planets/${planetId}/tools/${t.type}/${t.name}/fork-from-global`),
    )
  }

  function del(t: ToolSummary) {
    if (!confirm(`Delete ${t.type} "${t.name}" from ${SCOPE_LABEL[t.scope]}?`)) return
    void runAction(keyOf(t), () => {
      const url =
        t.scope === 'global'
          ? `/api/global-tools/${t.type}/${t.name}`
          : `/api/planets/${planetId}/tools/${t.type}/${t.name}`
      return apiDelete(url)
    })
  }

  function createNew(type: ToolType) {
    setEditor({ kind: 'create', type, scope: planetId === null ? 'global' : 'planet' })
  }

  async function edit(t: ToolSummary) {
    if (t.scope !== 'planet' && t.scope !== 'global') return
    // Fetch full ToolEntry to populate the form.
    const url =
      t.scope === 'global'
        ? `/api/global-tools/${t.type}/${t.name}`
        : `/api/planets/${planetId}/tools/${t.scope}/${t.type}/${t.name}`
    const res = await apiGet<{ data: AnyToolData }>(url)
    if (!res.ok) {
      pushToast('error', `Could not load ${t.name}: ${res.error}`)
      return
    }
    setEditor({ kind: 'edit', type: t.type, scope: t.scope, initial: res.data.data })
  }

  if (tools === null && error === null) {
    return <EmptyMessage>loading library…</EmptyMessage>
  }
  if (error) {
    return <p className="text-rose-300">// error: {error}</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button
          onClick={() => void refetch()}
          className="text-[10px] text-zinc-400 hover:text-cyan-200"
          title="rescan disk"
        >
          ↻ refresh
        </button>
      </div>

      {TYPE_ORDER.map((type) => {
        const list = byType[type]
        return (
          <section key={type}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] tracking-widest text-zinc-500">
                {TYPE_LABEL[type]} ({list.length})
              </h3>
              <button
                onClick={() => createNew(type)}
                className="text-[10px] text-cyan-300 hover:text-cyan-200 border border-cyan-500/40 px-2 py-0.5 hover:bg-cyan-500/10"
              >
                + new {type}
              </button>
            </div>
            {list.length === 0 ? (
              <EmptyMessage>none</EmptyMessage>
            ) : (
              <ul className="space-y-1">
                {list.map((t) => {
                  const isBusy = busy === keyOf(t)
                  return (
                    <li
                      key={keyOf(t)}
                      className={`border border-cyan-500/15 rounded px-2 py-1.5 flex items-start gap-2 ${
                        isBusy ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-cyan-300 truncate">{t.name}</span>
                          <span
                            className={`text-[10px] tracking-wider border rounded px-1 py-0 ${SCOPE_CLASS[t.scope]}`}
                          >
                            {SCOPE_LABEL[t.scope]}
                          </span>
                        </div>
                        {t.description && (
                          <p className="text-zinc-400 text-[11px] mt-0.5 line-clamp-2">{t.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 text-[10px]">
                        {(t.scope === 'planet' || t.scope === 'global') && (
                          <button
                            disabled={isBusy}
                            onClick={() => void edit(t)}
                            className="px-2 py-0.5 border border-zinc-600 text-zinc-300 hover:border-cyan-400 hover:text-cyan-200 disabled:opacity-30"
                          >
                            edit
                          </button>
                        )}
                        {actionsForScope(t.scope, planetId !== null).map((action) => (
                          <button
                            key={action}
                            disabled={isBusy}
                            onClick={() => {
                              if (action === 'adopt → planet') adopt(t, 'planet')
                              else if (action === 'adopt → global') adopt(t, 'global')
                              else if (action === '↑ elevate') elevate(t)
                              else if (action === '↓ fork') fork(t)
                              else if (action === 'delete') del(t)
                            }}
                            className="px-2 py-0.5 border border-zinc-600 text-zinc-300 hover:border-cyan-400 hover:text-cyan-200 disabled:opacity-30"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}

      <section>
        <h3 className="text-[10px] tracking-widest text-zinc-500 mb-2">DETECTED CLIs</h3>
        {clis === null ? (
          <EmptyMessage>probing…</EmptyMessage>
        ) : (
          <ul className="space-y-1">
            {clis.map((c) => (
              <li
                key={c.name}
                className="border border-cyan-500/15 rounded px-2 py-1 flex items-center justify-between"
              >
                <span className={c.available ? 'text-cyan-300' : 'text-zinc-600'}>{c.name}</span>
                <span className="text-[10px] text-zinc-500 font-mono truncate ml-2">
                  {c.available ? c.version : 'not installed'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-zinc-600 mt-2 italic">
          // drones with the Claude Code tool preset can call these via Bash.
        </p>
      </section>

      {editor && (
        <Suspense fallback={null}>
          <ToolEditorModal
            mode={editor}
            planetId={planetId}
            library={tools ?? []}
            onClose={() => setEditor(null)}
            onSaved={() => void refetch()}
          />
        </Suspense>
      )}
    </div>
  )
}

function actionsForScope(scope: ToolScope, hasPlanet: boolean): string[] {
  switch (scope) {
    case 'claude-project':
      return hasPlanet ? ['adopt → planet'] : []
    case 'claude-user':
      return ['adopt → global']
    case 'planet':
      return hasPlanet ? ['↑ elevate', 'delete'] : []
    case 'global':
      return hasPlanet ? ['↓ fork', 'delete'] : ['delete']
  }
}
