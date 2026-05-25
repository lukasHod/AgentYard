import { Handle, Position } from '@xyflow/react'
import type { WorkflowNode } from '../../../core/schema'

const TYPE_COLOR: Record<WorkflowNode['type'], string> = {
  ai: 'border-cyan-500/60 text-cyan-200',
  custom: 'border-amber-500/60 text-amber-200',
}

export function WorkflowNodeView({
  data,
  selected,
}: {
  data: { node: WorkflowNode }
  selected?: boolean
}) {
  const n = data.node
  const subtitle =
    n.type === 'ai'
      ? `${(n.agents ?? []).length} agent${(n.agents ?? []).length === 1 ? '' : 's'}`
      : n.scriptName
        ? `script: ${n.scriptName}`
        : 'custom (no script)'
  return (
    <div
      className={`px-4 py-3 rounded border-2 ${TYPE_COLOR[n.type]} bg-black/90 font-mono min-w-[180px] shadow-lg ${
        selected ? 'ring-2 ring-cyan-400' : ''
      }`}
    >
      <div className="text-[10px] tracking-widest opacity-70 uppercase">{n.type}</div>
      <div className="text-sm mt-0.5">{n.title}</div>
      <div className="text-[10px] mt-2 text-zinc-500">{subtitle}</div>
      <Handle type="target" position={Position.Left} style={{ background: '#22d3ee' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#22d3ee' }} />
    </div>
  )
}
