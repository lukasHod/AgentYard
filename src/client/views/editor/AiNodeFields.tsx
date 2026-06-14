import type { WorkflowNode } from '../../../core/schema'
import type { ToolSummary } from '../../../core/tools'

export function AiNodeFields({
  node,
  agents,
  onChange,
  onOpenToolEditor,
  onCreateAgent,
}: {
  node: WorkflowNode
  agents: ToolSummary[]
  onChange: (patch: Partial<WorkflowNode>) => void
  onOpenToolEditor: (t: ToolSummary) => void
  onCreateAgent: () => void
}) {
  const attached = node.agents ?? []
  return (
    <>
      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">
          RUNTIME
        </label>
        <select
          value={node.agentKind ?? ''}
          onChange={(e) => onChange({ agentKind: (e.target.value as 'claude-sdk' | 'claude-code-cli' | 'codex-cli') || undefined })}
          className="w-full bg-black border border-cyan-500/40 rounded p-1.5 text-zinc-200 text-xs focus:outline-none focus:border-cyan-300"
        >
          <option value="">(inherit from feature → planet → global)</option>
          <option value="claude-sdk">claude-sdk — in-process SDK agent</option>
          <option value="claude-code-cli">claude-code-cli — Claude Code CLI in terminal</option>
          <option value="codex-cli">codex-cli — Codex CLI in terminal</option>
        </select>
      </div>

      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">
          PROMPT (supports {'{task}'} and {'{upstream_outputs}'})
        </label>
        <textarea
          value={node.prompt ?? ''}
          onChange={(e) => onChange({ prompt: e.target.value })}
          rows={10}
          className="w-full bg-black border border-cyan-500/40 rounded p-2 text-zinc-200 focus:outline-none focus:border-cyan-300 font-mono"
        />
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-[10px] tracking-widest text-zinc-500 block">AGENTS</label>
          <button
            type="button"
            onClick={onCreateAgent}
            className="px-2 py-0.5 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-500/20 text-[10px] tracking-wide"
          >
            + new agent
          </button>
        </div>
        {agents.length === 0 ? (
          <p className="text-[10px] text-zinc-600">
            // no agents in the global library. create one here and it will be attached to this
            node.
          </p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
            {agents.map((a) => {
              const isAttached = attached.includes(a.name)
              const editable = a.scope === 'global' || a.scope === 'planet'
              return (
                <label
                  key={a.name}
                  className="flex items-start gap-2 cursor-pointer hover:bg-zinc-800/40 px-1 py-0.5 rounded"
                >
                  <input
                    type="checkbox"
                    checked={isAttached}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...attached, a.name]
                        : attached.filter((n) => n !== a.name)
                      onChange({ agents: next })
                    }}
                    className="mt-0.5 accent-cyan-500"
                  />
                  <span className="flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-cyan-300">{a.name}</span>
                      <span className="text-[10px] text-zinc-600">({a.scope})</span>
                      {editable && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onOpenToolEditor(a)
                          }}
                          className="text-[10px] text-zinc-500 hover:text-cyan-300 underline"
                          title="open agent definition — system prompt, tool preset, attached skills/mcps/scripts"
                        >
                          edit
                        </button>
                      )}
                    </span>
                    {a.description && (
                      <span className="block text-[10px] text-zinc-500 leading-tight">
                        {a.description}
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        )}
        {attached
          .filter((n) => !agents.find((a) => a.name === n))
          .map((n) => (
            <div key={n} className="flex items-center gap-1 mt-1">
              <span className="flex-1 text-amber-300 text-[10px]">
                {n} <span className="text-zinc-500">(missing from library)</span>
              </span>
              <button
                onClick={() => onChange({ agents: attached.filter((x) => x !== n) })}
                className="px-2 py-0.5 border border-rose-500/60 text-rose-300 hover:bg-rose-500/20 text-[10px]"
              >
                remove
              </button>
            </div>
          ))}
      </div>
    </>
  )
}
