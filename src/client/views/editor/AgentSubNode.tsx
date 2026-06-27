import { Handle, Position } from '@xyflow/react'

export interface AgentSubNodeData extends Record<string, unknown> {
  agentName: string
  description?: string
  workflowNodeId: string
}

export function AgentSubNode({
  data,
  selected,
}: {
  data: AgentSubNodeData
  selected?: boolean
}) {
  return (
    <div
      className={`px-3 py-2 rounded border ${
        selected ? 'border-violet-400 ring-1 ring-violet-400' : 'border-violet-500/60'
      } bg-black/90 font-mono min-w-[140px] shadow-md cursor-pointer`}
    >
      <div className="text-[9px] tracking-widest text-violet-500 uppercase">agent</div>
      <div className="text-xs text-violet-200 mt-0.5 truncate">{data.agentName}</div>
      {data.description && (
        <div className="text-[9px] text-zinc-600 mt-1 leading-tight line-clamp-2">
          {data.description}
        </div>
      )}
      {/* Both top and bottom handles for the parent AI node connection — the active
          one is picked dynamically based on relative Y position */}
      <Handle id="conn-top" type="target" position={Position.Top} style={{ background: '#8b5cf6' }} />
      <Handle id="conn-bottom" type="target" position={Position.Bottom} style={{ background: '#8b5cf6' }} />
      {/* Outgoing to skill nodes */}
      <Handle id="skill-out" type="source" position={Position.Bottom} style={{ background: '#d946ef', left: '75%' }} />
    </div>
  )
}
