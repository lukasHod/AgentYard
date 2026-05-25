import { useEffect, useState } from 'react'
import type { WorkflowNode } from '../../../core/schema'
import type { ScriptTool, ToolSummary } from '../../../core/tools'
import { apiGet } from '../../api'
import { EmptyMessage } from '../../components/ui/EmptyMessage'

export function CustomNodeFields({
  node,
  scripts,
  onChange,
  onOpenToolEditor,
}: {
  node: WorkflowNode
  scripts: ToolSummary[]
  onChange: (patch: Partial<WorkflowNode>) => void
  onOpenToolEditor: (t: ToolSummary) => void
}) {
  const selectedScript = node.scriptName ? scripts.find((s) => s.name === node.scriptName) : null
  const selectedScriptEditable =
    selectedScript && (selectedScript.scope === 'global' || selectedScript.scope === 'ship')
  const [scriptArgs, setScriptArgs] = useState<ScriptTool['args']>([])
  const [loadingArgs, setLoadingArgs] = useState(false)

  // Fetch the chosen script's args list whenever the script name changes.
  useEffect(() => {
    let cancelled = false
    const name = node.scriptName
    if (!name) {
      setScriptArgs([])
      return
    }
    // The summary doesn't include args — fetch the full script entry.
    setLoadingArgs(true)
    const entry = scripts.find((s) => s.name === name)
    // We need to pick the same scope used in /api/global-tools/script/<name>.
    // The endpoint resolves global scope only — that's the catalog the editor
    // lists from, so it matches.
    if (!entry) {
      setScriptArgs([])
      setLoadingArgs(false)
      return
    }
    void apiGet<{ data: ScriptTool }>(
      `/api/global-tools/script/${encodeURIComponent(name)}`,
    ).then((res) => {
      if (cancelled) return
      setScriptArgs(res.ok ? res.data.data.args ?? [] : [])
      setLoadingArgs(false)
    })
    return () => {
      cancelled = true
    }
  }, [node.scriptName, scripts])

  const currentArgs = node.args ?? {}

  return (
    <>
      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">SCRIPT</label>
        <div className="flex items-center gap-2">
          <select
            value={node.scriptName ?? ''}
            onChange={(e) => onChange({ scriptName: e.target.value || undefined, args: {} })}
            className="flex-1 bg-black border border-amber-500/40 rounded px-2 py-1 focus:outline-none focus:border-amber-300"
          >
            <option value="">// pick a script</option>
            {scripts.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.scope})
              </option>
            ))}
          </select>
          {selectedScript && selectedScriptEditable && (
            <button
              type="button"
              onClick={() => onOpenToolEditor(selectedScript)}
              className="px-2 py-1 border border-amber-500/60 text-amber-300 hover:bg-amber-500/20 text-[10px]"
              title="open script definition — cmd, args, body"
            >
              edit
            </button>
          )}
        </div>
        {scripts.length === 0 && (
          <p className="text-[10px] text-zinc-600 mt-1">
            // no scripts in the global library. create one from{' '}
            <span className="text-cyan-400">ships → tools</span>.
          </p>
        )}
      </div>

      {node.scriptName && (
        <div>
          <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">
            ARGS (values support {'{task}'} and {'{upstream_outputs}'})
          </label>
          {loadingArgs ? (
            <EmptyMessage className="text-[10px]">loading arg schema…</EmptyMessage>
          ) : scriptArgs.length === 0 ? (
            <EmptyMessage className="text-[10px]">this script takes no args</EmptyMessage>
          ) : (
            <div className="space-y-2">
              {scriptArgs.map((arg) => (
                <div key={arg.name}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-amber-300">{arg.name}</span>
                    {arg.required && <span className="text-rose-400 text-[10px]">required</span>}
                  </div>
                  {arg.description && (
                    <p className="text-[10px] text-zinc-600 leading-tight mb-1">
                      {arg.description}
                    </p>
                  )}
                  <input
                    value={currentArgs[arg.name] ?? ''}
                    onChange={(e) =>
                      onChange({ args: { ...currentArgs, [arg.name]: e.target.value } })
                    }
                    className="w-full bg-black border border-zinc-600 rounded px-2 py-1 focus:outline-none focus:border-amber-300"
                    placeholder={`{${arg.name}}`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
