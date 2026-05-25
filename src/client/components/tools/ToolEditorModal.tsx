import { useState } from 'react'
import type {
  AgentTool,
  McpTool,
  ScriptTool,
  SkillTool,
  ToolSummary,
  ToolType,
} from '../../../core/tools'
import { useDismissable } from '../../hooks/useDismissable'
import { SkillForm } from './forms/SkillForm'
import { McpForm } from './forms/McpForm'
import { ScriptForm } from './forms/ScriptForm'
import { AgentForm } from './forms/AgentForm'

export type EditorScope = 'ship' | 'global'

export type EditorMode =
  | { kind: 'create'; type: ToolType; scope: EditorScope }
  | { kind: 'edit'; type: ToolType; scope: EditorScope; initial: AnyToolData }

export type AnyToolData = SkillTool | McpTool | ScriptTool | AgentTool

interface Props {
  mode: EditorMode
  shipId: number | null
  library: ToolSummary[]
  onClose: () => void
  onSaved: () => void
}

const TYPE_TITLE: Record<ToolType, string> = {
  skill: 'SKILL',
  agent: 'AGENT',
  mcp: 'MCP',
  script: 'SCRIPT',
}

export function ToolEditorModal({ mode, shipId, library, onClose, onSaved }: Props) {
  useDismissable(true, onClose)
  const [saving, setSaving] = useState(false)
  const [scope, setScope] = useState<EditorScope>(mode.scope)
  const editing = mode.kind === 'edit'
  const title = `${editing ? 'EDIT' : 'CREATE'} ${TYPE_TITLE[mode.type]}`

  async function save(data: AnyToolData) {
    setSaving(true)
    try {
      const res = await persist(mode, scope, shipId, data)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Save failed: ${j.error ?? res.status}`)
        return
      }
      onSaved()
      onClose()
    } catch (e) {
      alert(`Network error: ${e}`)
    } finally {
      setSaving(false)
    }
  }

  function renderForm() {
    switch (mode.type) {
      case 'skill':
        return (
          <SkillForm
            initial={mode.kind === 'edit' ? (mode.initial as SkillTool) : undefined}
            disableName={editing}
            onSubmit={save}
            onCancel={onClose}
            saving={saving}
          />
        )
      case 'mcp':
        return (
          <McpForm
            initial={mode.kind === 'edit' ? (mode.initial as McpTool) : undefined}
            disableName={editing}
            onSubmit={save}
            onCancel={onClose}
            saving={saving}
          />
        )
      case 'script':
        return (
          <ScriptForm
            initial={mode.kind === 'edit' ? (mode.initial as ScriptTool) : undefined}
            disableName={editing}
            onSubmit={save}
            onCancel={onClose}
            saving={saving}
          />
        )
      case 'agent':
        return (
          <AgentForm
            initial={mode.kind === 'edit' ? (mode.initial as AgentTool) : undefined}
            disableName={editing}
            library={library}
            onSubmit={save}
            onCancel={onClose}
            saving={saving}
          />
        )
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-30"
      onClick={onClose}
    >
      <div
        className="bg-black border border-cyan-500/60 rounded w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-cyan-500/40 px-4 py-2 flex items-center justify-between">
          <h2 className="text-cyan-300 tracking-widest">{title}</h2>
          <div className="flex items-center gap-2">
            {/* Only allow scope switching on create — editing in-place keeps the same scope. */}
            {!editing && (
              <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                save to:
                <button
                  onClick={() => setScope('ship')}
                  className={`px-2 py-0.5 border ${
                    scope === 'ship'
                      ? 'border-cyan-400 text-cyan-200 bg-cyan-500/10'
                      : 'border-zinc-600 text-zinc-400'
                  }`}
                  disabled={shipId === null}
                >
                  ship
                </button>
                <button
                  onClick={() => setScope('global')}
                  className={`px-2 py-0.5 border ${
                    scope === 'global'
                      ? 'border-emerald-400 text-emerald-200 bg-emerald-500/10'
                      : 'border-zinc-600 text-zinc-400'
                  }`}
                >
                  global
                </button>
              </span>
            )}
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
              ×
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{renderForm()}</div>
      </div>
    </div>
  )
}

async function persist(
  mode: EditorMode,
  scope: EditorScope,
  shipId: number | null,
  data: AnyToolData,
): Promise<Response> {
  const inShip = scope === 'ship'
  if (inShip && shipId === null) {
    throw new Error('Cannot save to ship scope without a shipId')
  }
  if (mode.kind === 'create') {
    const url = inShip
      ? `/api/ships/${shipId}/tools/${mode.type}`
      : `/api/global-tools/${mode.type}`
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    })
  }
  // edit
  const name = (data as { name: string }).name
  const url = inShip
    ? `/api/ships/${shipId}/tools/${mode.type}/${name}`
    : `/api/global-tools/${mode.type}/${name}`
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  })
}
