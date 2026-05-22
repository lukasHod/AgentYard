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
import type { ScriptTool, ToolSummary } from '../../core/tools'

interface Props {
  workflow: Workflow | null
  tools: ToolSummary[]
  onSave: (workflow: Workflow) => Promise<void> | void
  onRefreshTools: () => void
}

type WorkflowRFNode = RFNode<{ node: WorkflowNode }>

const TYPE_COLOR: Record<WorkflowNode['type'], string> = {
  ai: 'border-cyan-500/60 text-cyan-200',
  custom: 'border-amber-500/60 text-amber-200',
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

function uniqueId(existing: Set<string>, base: string): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export function EditorView({ workflow, tools, onSave, onRefreshTools }: Props) {
  const [nodes, setNodes] = useState<WorkflowRFNode[]>([])
  const [edges, setEdges] = useState<RFEdge[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!workflow) return
    setNodes(workflow.graph.nodes.map(toRFNode))
    setEdges(workflow.graph.edges.map(toRFEdge))
    setName(workflow.name)
    setDirty(false)
  }, [workflow])

  // Refresh tool palette every time the editor mounts so newly created
  // agents/scripts appear without a page reload.
  useEffect(() => {
    onRefreshTools()
  }, [onRefreshTools])

  const agents = useMemo(() => tools.filter((t) => t.type === 'agent'), [tools])
  const scripts = useMemo(() => tools.filter((t) => t.type === 'script'), [tools])

  const onNodesChange = useCallback((changes: NodeChange<WorkflowRFNode>[]) => {
    const removedIds = changes
      .filter((c): c is NodeChange<WorkflowRFNode> & { type: 'remove'; id: string } => c.type === 'remove')
      .map((c) => c.id)
    setNodes((nds) => applyNodeChanges(changes, nds))
    if (removedIds.length > 0) {
      // Garbage-collect orphan edges.
      setEdges((eds) =>
        eds.filter((e) => !removedIds.includes(e.source) && !removedIds.includes(e.target)),
      )
      setDirty(true)
      setSelectedId((cur) => (cur && removedIds.includes(cur) ? null : cur))
    } else if (changes.some((c) => c.type === 'position' && !c.dragging)) {
      setDirty(true)
    }
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
  const onPaneClick = useCallback(() => setSelectedId(null), [])

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

  function addNode(type: 'ai' | 'custom') {
    const existing = new Set(nodes.map((n) => n.id))
    const id = uniqueId(existing, type === 'ai' ? 'ai-node' : 'script-node')
    const offsetX = 120 + nodes.length * 40
    const offsetY = 120 + (nodes.length % 4) * 40
    const node: WorkflowNode =
      type === 'ai'
        ? {
            id,
            title: 'New AI node',
            type: 'ai',
            position: { x: offsetX, y: offsetY },
            prompt: '',
            agents: [],
          }
        : {
            id,
            title: 'New script node',
            type: 'custom',
            position: { x: offsetX, y: offsetY },
            customType: 'script',
            args: {},
          }
    setNodes((nds) => [...nds, toRFNode(node)])
    setSelectedId(id)
    setDirty(true)
  }

  function deleteSelected() {
    if (!selectedId) return
    const id = selectedId
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
    setSelectedId(null)
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
          <span className="mx-1 text-zinc-700">|</span>
          <button
            onClick={() => addNode('ai')}
            className="px-3 py-1 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-500/20"
          >
            + AI node
          </button>
          <button
            onClick={() => addNode('custom')}
            className="px-3 py-1 border border-amber-500/60 text-amber-300 hover:bg-amber-500/20"
          >
            + script node
          </button>
          {selectedId && (
            <button
              onClick={deleteSelected}
              className="px-3 py-1 border border-rose-500/60 text-rose-300 hover:bg-rose-500/20"
              title="delete selected node (and connected edges)"
            >
              delete
            </button>
          )}
        </div>

        <div style={{ height: 'calc(100vh - 60px)' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={{ workflow: WorkflowNodeView }}
            colorMode="dark"
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      </div>

      <aside className="w-96 border-l border-cyan-500/30 p-4 overflow-y-auto text-xs">
        {selectedNode ? (
          <NodeEditor
            key={selectedNode.id}
            node={selectedNode}
            agents={agents}
            scripts={scripts}
            onChange={updateSelectedNode}
          />
        ) : (
          <p className="text-zinc-600 italic">
            // click a node to edit it, or use the palette to add one
          </p>
        )}
      </aside>
    </div>
  )
}

function NodeEditor({
  node,
  agents,
  scripts,
  onChange,
}: {
  node: WorkflowNode
  agents: ToolSummary[]
  scripts: ToolSummary[]
  onChange: (patch: Partial<WorkflowNode>) => void
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
        <AiNodeFields node={node} agents={agents} onChange={onChange} />
      ) : (
        <CustomNodeFields node={node} scripts={scripts} onChange={onChange} />
      )}
    </div>
  )
}

function AiNodeFields({
  node,
  agents,
  onChange,
}: {
  node: WorkflowNode
  agents: ToolSummary[]
  onChange: (patch: Partial<WorkflowNode>) => void
}) {
  const attached = node.agents ?? []
  return (
    <>
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
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">AGENTS</label>
        {agents.length === 0 ? (
          <p className="text-[10px] text-zinc-600">
            // no agents in the global library. seed them from{' '}
            <span className="text-cyan-400">ships → tools</span>.
          </p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
            {agents.map((a) => {
              const isAttached = attached.includes(a.name)
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
                    <span className="text-cyan-300">{a.name}</span>
                    <span className="text-[10px] text-zinc-600 ml-1">({a.scope})</span>
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

function CustomNodeFields({
  node,
  scripts,
  onChange,
}: {
  node: WorkflowNode
  scripts: ToolSummary[]
  onChange: (patch: Partial<WorkflowNode>) => void
}) {
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
    fetch(`/api/global-tools/script/${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        const args = (data?.data?.args ?? []) as ScriptTool['args']
        setScriptArgs(args)
      })
      .catch(() => {
        if (!cancelled) setScriptArgs([])
      })
      .finally(() => !cancelled && setLoadingArgs(false))
    return () => {
      cancelled = true
    }
  }, [node.scriptName, scripts])

  const currentArgs = node.args ?? {}

  return (
    <>
      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">SCRIPT</label>
        <select
          value={node.scriptName ?? ''}
          onChange={(e) => onChange({ scriptName: e.target.value || undefined, args: {} })}
          className="w-full bg-black border border-amber-500/40 rounded px-2 py-1 focus:outline-none focus:border-amber-300"
        >
          <option value="">// pick a script</option>
          {scripts.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.scope})
            </option>
          ))}
        </select>
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
            <p className="text-[10px] text-zinc-600 italic">// loading arg schema…</p>
          ) : scriptArgs.length === 0 ? (
            <p className="text-[10px] text-zinc-600 italic">// this script takes no args</p>
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
