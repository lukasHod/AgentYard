import { Handle, Position } from '@xyflow/react'

export interface SkillSubNodeData extends Record<string, unknown> {
  skillName: string
}

export function SkillSubNode({
  data,
  selected,
}: {
  data: SkillSubNodeData
  selected?: boolean
}) {
  return (
    <div
      className={`px-2 py-1.5 rounded border ${
        selected ? 'border-fuchsia-400 ring-1 ring-fuchsia-400' : 'border-fuchsia-500/40'
      } bg-black/90 font-mono shadow-sm`}
    >
      <div className="text-[9px] tracking-widest text-fuchsia-600 uppercase">skill</div>
      <div className="text-[10px] text-fuchsia-300 mt-0.5 truncate max-w-[120px]">
        {data.skillName}
      </div>
      {/* Incoming from agent node (top center) */}
      <Handle id="skill-in" type="target" position={Position.Top} style={{ background: '#d946ef' }} />
    </div>
  )
}
