import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ToolScope, ToolSummary, ToolType } from '../../core/tools'
import { ToolEditorModal, type AnyToolData, type EditorMode } from './tools/ToolEditorModal'

interface Props {
  /** Null when used in the galaxy library view — list endpoint switches to /api/global-tools. */
  shipId: number | null
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
  ship: 'agentyard',
  global: 'global',
  'claude-project': '.claude project',
  'claude-user': '.claude user',
}

const SCOPE_CLASS: Record<ToolScope, string> = {
  ship: 'border-cyan-500/60 text-cyan-200',
  global: 'border-emerald-500/60 text-emerald-200',
  'claude-project': 'border-zinc-500/60 text-zinc-300',
  'claude-user': 'border-zinc-500/60 text-zinc-300',
}

export function ToolsTabContent({ shipId }: Props) {
  const [tools, setTools] = useState<ToolSummary[] | null>(null)
  const [clis, setClis] = useState<CLIInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // key of tool currently performing an action
  const [editor, setEditor] = useState<EditorMode | null>(null)

  const refetch = useCallback(async () => {
    try {
      const url = shipId === null ? '/api/global-tools' : `/api/ships/${shipId}/tools`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`tools ${res.status}`)
      setTools(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [shipId])

  useEffect(() => {
    void refetch()
    if (clis === null) {
      fetch('/api/clis')
        .then((r) => r.json())
        .then(setClis)
        .catch(() => setClis([]))
    }
  }, [shipId, refetch, clis])

  // Group by type, preserving the order in TYPE_ORDER.
  const byType = useMemo(() => {
    const m: Record<ToolType, ToolSummary[]> = { skill: [], agent: [], mcp: [], script: [] }
    for (const t of tools ?? []) m[t.type].push(t)
    return m
  }, [tools])

  const keyOf = (t: ToolSummary) => `${t.scope}/${t.type}/${t.name}`

  async function runAction(label: string, fn: () => Promise<Response>) {
    setBusy(label)
    try {
      const res = await fn()
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Failed: ${j.error ?? res.status}`)
      }
      await refetch()
    } catch (e) {
      alert(`Network error: ${e}`)
    } finally {
      setBusy(null)
    }
  }

  function adopt(t: ToolSummary, target: 'ship' | 'global') {
    if (target === 'ship' && shipId === null) return
    void runAction(keyOf(t), () => {
      // In galaxy library view: only claude-user → global is supported, via a different endpoint.
      if (shipId === null) {
        return fetch(`/api/global-tools/adopt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: t.type, name: t.name }),
        })
      }
      return fetch(`/api/ships/${shipId}/tools/adopt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceScope: t.scope, type: t.type, name: t.name, target }),
      })
    })
  }

  function elevate(t: ToolSummary) {
    if (shipId === null) return
    void runAction(keyOf(t), () =>
      fetch(`/api/ships/${shipId}/tools/${t.type}/${t.name}/elevate`, { method: 'POST' }),
    )
  }

  function fork(t: ToolSummary) {
    if (shipId === null) return
    void runAction(keyOf(t), () =>
      fetch(`/api/ships/${shipId}/tools/${t.type}/${t.name}/fork-from-global`, { method: 'POST' }),
    )
  }

  function del(t: ToolSummary) {
    if (!confirm(`Delete ${t.type} "${t.name}" from ${SCOPE_LABEL[t.scope]}?`)) return
    void runAction(keyOf(t), () => {
      const url =
        t.scope === 'global'
          ? `/api/global-tools/${t.type}/${t.name}`
          : `/api/ships/${shipId}/tools/${t.type}/${t.name}`
      return fetch(url, { method: 'DELETE' })
    })
  }

  function createNew(type: ToolType) {
    setEditor({ kind: 'create', type, scope: shipId === null ? 'global' : 'ship' })
  }

  async function edit(t: ToolSummary) {
    if (t.scope !== 'ship' && t.scope !== 'global') return
    // Fetch full ToolEntry to populate the form.
    const url =
      t.scope === 'global'
        ? `/api/global-tools/${t.type}/${t.name}`
        : `/api/ships/${shipId}/tools/${t.scope}/${t.type}/${t.name}`
    const res = await fetch(url)
    if (!res.ok) {
      alert(`Could not load ${t.name}`)
      return
    }
    const entry = (await res.json()) as { data: AnyToolData }
    setEditor({ kind: 'edit', type: t.type, scope: t.scope, initial: entry.data })
  }

  if (tools === null && error === null) {
    return <p className="text-zinc-600 italic">// loading library…</p>
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
              <p className="text-zinc-600 italic">// none</p>
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
                        {(t.scope === 'ship' || t.scope === 'global') && (
                          <button
                            disabled={isBusy}
                            onClick={() => void edit(t)}
                            className="px-2 py-0.5 border border-zinc-600 text-zinc-300 hover:border-cyan-400 hover:text-cyan-200 disabled:opacity-30"
                          >
                            edit
                          </button>
                        )}
                        {actionsForScope(t.scope, shipId !== null).map((action) => (
                          <button
                            key={action}
                            disabled={isBusy}
                            onClick={() => {
                              if (action === 'adopt → ship') adopt(t, 'ship')
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
          <p className="text-zinc-600 italic">// probing…</p>
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
        <ToolEditorModal
          mode={editor}
          shipId={shipId}
          library={tools ?? []}
          onClose={() => setEditor(null)}
          onSaved={() => void refetch()}
        />
      )}
    </div>
  )
}

function actionsForScope(scope: ToolScope, hasShip: boolean): string[] {
  switch (scope) {
    case 'claude-project':
      return hasShip ? ['adopt → ship'] : []
    case 'claude-user':
      return ['adopt → global']
    case 'ship':
      return hasShip ? ['↑ elevate', 'delete'] : []
    case 'global':
      return hasShip ? ['↓ fork', 'delete'] : ['delete']
  }
}
