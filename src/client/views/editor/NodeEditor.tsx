import type { WorkflowNode } from '../../../core/schema'
import type { ToolSummary } from '../../../core/tools'
import { AiNodeFields } from './AiNodeFields'
import { CustomNodeFields } from './CustomNodeFields'

export function NodeEditor({
  node,
  agents,
  scripts,
  onChange,
  onOpenToolEditor,
}: {
  node: WorkflowNode
  agents: ToolSummary[]
  scripts: ToolSummary[]
  onChange: (patch: Partial<WorkflowNode>) => void
  onOpenToolEditor: (t: ToolSummary) => void
}) {
  return (
    <div className="space-y-4 text-zinc-300">
      <div>
        <div className="text-[10px] tracking-widest text-zinc-500 mb-1">ID</div>
        <div className="text-zinc-400">{node.id}</div>
      </div>

      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">TITLE</label>
        <input
          value={node.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="w-full bg-black border border-cyan-500/40 rounded px-2 py-1 focus:outline-none focus:border-cyan-300"
        />
      </div>

      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">TYPE</label>
        <select
          value={node.type}
          onChange={(e) => {
            const t = e.target.value as 'ai' | 'custom'
            if (t === node.type) return
            if (t === 'ai') {
              onChange({
                type: 'ai',
                prompt: '',
                agents: [],
                customType: undefined,
                scriptName: undefined,
                args: undefined,
              })
            } else {
              onChange({
                type: 'custom',
                customType: 'script',
                args: {},
                prompt: undefined,
                agents: undefined,
              })
            }
          }}
          className="w-full bg-black border border-cyan-500/40 rounded px-2 py-1 focus:outline-none focus:border-cyan-300"
        >
          <option value="ai">ai (leader + agents)</option>
          <option value="custom">custom (script)</option>
        </select>
      </div>

      {node.type === 'ai' ? (
        <AiNodeFields
          node={node}
          agents={agents}
          onChange={onChange}
          onOpenToolEditor={onOpenToolEditor}
        />
      ) : (
        <CustomNodeFields
          node={node}
          scripts={scripts}
          onChange={onChange}
          onOpenToolEditor={onOpenToolEditor}
        />
      )}
    </div>
  )
}
