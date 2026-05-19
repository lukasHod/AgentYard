import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  applyEdgeChanges,
  applyNodeChanges,
  addEdge,
  type Connection,
  type Edge as RFEdge,
  type EdgeChange,
  type Node as RFNode,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Workflow, WorkflowGraph, WorkflowNode } from '../../core/schema'

interface Props {
  workflow: Workflow | null
  onSave: (workflow: Workflow) => Promise<void> | void
}

type WorkflowRFNode = RFNode<{ node: WorkflowNode }>

const KIND_COLOR: Record<WorkflowNode['kind'], string> = {
  analyze: 'border-cyan-500/60 text-cyan-200',
  develop: 'border-fuchsia-500/60 text-fuchsia-200',
  deploy: 'border-emerald-500/60 text-emerald-200',
  custom: 'border-zinc-500/60 text-zinc-200',
}

function toRFNode(node: WorkflowNode): WorkflowRFNode {
  return {
    id: node.id,
    position: node.position,
    type: 'workflow',
    data: { node },
  }
}

function toRFEdge(e: { from: string; to: string }): RFEdge {
  return { id: `${e.from}->${e.to}`, source: e.from, target: e.to, animated: true }
}

function WorkflowNodeView({ data, selected }: { data: { node: WorkflowNode }; selected?: boolean }) {
  const n = data.node
  return (
    <div
      className={`px-4 py-3 rounded border-2 ${KIND_COLOR[n.kind]} bg-black/90 font-mono min-w-[180px] shadow-lg ${
        selected ? 'ring-2 ring-cyan-400' : ''
      }`}
    >
      <div className="text-[10px] tracking-widest opacity-70 uppercase">{n.kind}</div>
      <div className="text-sm mt-0.5">{n.title}</div>
      <div className="text-[10px] mt-2 text-zinc-500">
        {n.drones.length} drone{n.drones.length === 1 ? '' : 's'} · {n.skills.length} skill
        {n.skills.length === 1 ? '' : 's'}
      </div>
      <Handle type="target" position={Position.Left} style={{ background: '#22d3ee' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#22d3ee' }} />
    </div>
  )
}

export function EditorView({ workflow, onSave }: Props) {
  const [nodes, setNodes] = useState<WorkflowRFNode[]>([])
  const [edges, setEdges] = useState<RFEdge[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Sync workflow → local state when it (re)loads.
  useEffect(() => {
    if (!workflow) return
    setNodes(workflow.graph.nodes.map(toRFNode))
    setEdges(workflow.graph.edges.map(toRFEdge))
    setName(workflow.name)
    setDirty(false)
  }, [workflow])

  const onNodesChange = useCallback((changes: NodeChange<WorkflowRFNode>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds))
    if (changes.some((c) => c.type === 'position' && !c.dragging)) setDirty(true)
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds))
    if (changes.some((c) => c.type === 'remove')) setDirty(true)
  }, [])

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return
    setEdges((eds) =>
      addEdge({ ...conn, id: `${conn.source}->${conn.target}`, animated: true }, eds),
    )
    setDirty(true)
  }, [])

  const onNodeClick = useCallback((_: unknown, n: WorkflowRFNode) => setSelectedId(n.id), [])

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId)?.data.node,
    [nodes, selectedId],
  )

  function updateSelectedNode(patch: Partial<WorkflowNode>) {
    if (!selectedId) return
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n
        const merged = { ...n.data.node, ...patch }
        return { ...n, data: { node: merged } }
      }),
    )
    setDirty(true)
  }

  async function handleSave() {
    if (!workflow) return
    setSaving(true)
    const graph: WorkflowGraph = {
      nodes: nodes.map((n) => ({ ...n.data.node, position: n.position })),
      edges: edges.map((e) => ({ from: e.source, to: e.target })),
    }
    await onSave({ ...workflow, name, graph })
    setSaving(false)
    setDirty(false)
  }

  if (!workflow) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
        // loading workflow...
      </div>
    )
  }

  return (
    <div className="flex-1 flex">
      {/* Canvas */}
      <div className="flex-1 relative">
        <div className="absolute top-2 left-2 z-10 flex items-center gap-2 text-xs">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setDirty(true)
            }}
            className="bg-black border border-cyan-500/40 rounded px-2 py-1 w-72 focus:outline-none focus:border-cyan-300"
            placeholder="workflow name"
          />
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-3 py-1 border border-emerald-500 text-emerald-300 hover:bg-emerald-500 hover:text-black tracking-wide disabled:opacity-30"
          >
            {saving ? 'saving…' : dirty ? 'save' : 'saved ✓'}
          </button>
        </div>

        <div style={{ height: 'calc(100vh - 60px)' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={{ workflow: WorkflowNodeView }}
            colorMode="dark"
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      </div>

      {/* Properties panel */}
      <aside className="w-96 border-l border-cyan-500/30 p-4 overflow-y-auto text-xs">
        {selectedNode ? (
          <NodeEditor key={selectedNode.id} node={selectedNode} onChange={updateSelectedNode} />
        ) : (
          <p className="text-zinc-600 italic">// click a node to edit it</p>
        )}
      </aside>
    </div>
  )
}

function NodeEditor({
  node,
  onChange,
}: {
  node: WorkflowNode
  onChange: (patch: Partial<WorkflowNode>) => void
}) {
  return (
    <div className="space-y-4 text-zinc-300">
      <div>
        <div className="text-[10px] tracking-widest text-zinc-500 mb-1">ID</div>
        <div className="text-zinc-400">{node.id}</div>
      </div>

      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">KIND</label>
        <select
          value={node.kind}
          onChange={(e) => onChange({ kind: e.target.value as WorkflowNode['kind'] })}
          className="w-full bg-black border border-cyan-500/40 rounded px-2 py-1 focus:outline-none focus:border-cyan-300"
        >
          <option value="analyze">analyze</option>
          <option value="develop">develop</option>
          <option value="deploy">deploy</option>
          <option value="custom">custom</option>
        </select>
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
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">
          PROMPT (supports {'{task}'} and {'{upstream_outputs}'})
        </label>
        <textarea
          value={node.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          rows={10}
          className="w-full bg-black border border-cyan-500/40 rounded p-2 text-zinc-200 focus:outline-none focus:border-cyan-300 font-mono"
        />
      </div>

      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">DRONES</label>
        <div className="space-y-1">
          {node.drones.map((d, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                value={d.role}
                onChange={(e) => {
                  const next = [...node.drones]
                  next[i] = { ...d, role: e.target.value }
                  onChange({ drones: next })
                }}
                className="flex-1 bg-black border border-cyan-500/40 rounded px-2 py-1"
              />
              <button
                onClick={() => onChange({ drones: node.drones.filter((_, j) => j !== i) })}
                className="px-2 py-1 border border-rose-500/60 text-rose-300 hover:bg-rose-500/20"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              onChange({
                drones: [...node.drones, { role: 'new-role', requiredSkills: [], required: true }],
              })
            }
            className="px-2 py-1 border border-zinc-500 text-zinc-400 hover:bg-zinc-700"
          >
            + add drone
          </button>
        </div>
      </div>

      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">SKILLS</label>
        <div className="space-y-1">
          {node.skills.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                value={s}
                onChange={(e) => {
                  const next = [...node.skills]
                  next[i] = e.target.value
                  onChange({ skills: next })
                }}
                className="flex-1 bg-black border border-cyan-500/40 rounded px-2 py-1"
              />
              <button
                onClick={() => onChange({ skills: node.skills.filter((_, j) => j !== i) })}
                className="px-2 py-1 border border-rose-500/60 text-rose-300 hover:bg-rose-500/20"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() => onChange({ skills: [...node.skills, 'new-skill'] })}
            className="px-2 py-1 border border-zinc-500 text-zinc-400 hover:bg-zinc-700"
          >
            + add skill
          </button>
        </div>
        <p className="text-[10px] text-zinc-600 mt-1">(skills are placeholders for Phase 4)</p>
      </div>
    </div>
  )
}
