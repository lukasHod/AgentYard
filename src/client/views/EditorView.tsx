import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
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
import type { AgentTool, ToolSummary } from '../../core/tools'
import type { TestRunRequest } from './TestRunModal'
import type { EditorMode } from '../components/tools/ToolEditorModal'
import { apiGet } from '../api'
import { EmptyMessage } from '../components/ui/EmptyMessage'
import { pushToast } from '../state/toastStore'
import { NodeEditor } from './editor/NodeEditor'
import { WorkflowNodeView } from './editor/WorkflowNodeView'

const ToolEditorModal = lazy(() =>
  import('../components/tools/ToolEditorModal').then((m) => ({ default: m.ToolEditorModal })),
)

interface Props {
  workflow: Workflow | null
  planetId: number | null
  tools: ToolSummary[]
  onSave: (workflow: Workflow) => Promise<void> | void
  onRefreshTools: () => void
  onOpenTestRun: (req: TestRunRequest) => void
}

type WorkflowRFNode = RFNode<{ node: WorkflowNode }>

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

function uniqueId(existing: Set<string>, base: string): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export function EditorView({
  workflow,
  planetId,
  tools,
  onSave,
  onRefreshTools,
  onOpenTestRun,
}: Props) {
  const [nodes, setNodes] = useState<WorkflowRFNode[]>([])
  const [edges, setEdges] = useState<RFEdge[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toolEditor, setToolEditor] = useState<EditorMode | null>(null)

  // Click-through from a node's connected-agents list (or chosen script) to
  // open the tool editor modal with that tool's definition prefilled.
  const openToolEditor = useCallback(async (t: ToolSummary) => {
    if (t.scope !== 'global' && t.scope !== 'planet') {
      pushToast(
        'error',
        `'${t.name}' has scope=${t.scope}, which can't be edited here — adopt or fork it first via the Tools tab.`,
      )
      return
    }
    if (t.scope === 'planet' && planetId === null) {
      pushToast('error', `'${t.name}' is project-scoped, but no project is active.`)
      return
    }
    const detailUrl =
      planetId === null
        ? `/api/global-tools/${t.type}/${encodeURIComponent(t.name)}`
        : `/api/planets/${planetId}/tools/${t.scope}/${t.type}/${encodeURIComponent(t.name)}`
    const res = await apiGet<{ data: unknown }>(detailUrl)
    if (!res.ok) {
      pushToast('error', `Could not load ${t.type} '${t.name}': ${res.error}`)
      return
    }
    // ToolEditorModal validates the shape via its EditorMode discriminator.
    setToolEditor({
      kind: 'edit',
      type: t.type,
      scope: t.scope,
      initial: res.data.data as never,
    })
  }, [planetId])

  const openCreateAgent = useCallback(() => {
    setToolEditor({ kind: 'create', type: 'agent', scope: planetId === null ? 'global' : 'planet' })
  }, [planetId])

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

  const agents = useMemo(
    () =>
      tools.filter((t) => t.type === 'agent' && (t.scope === 'planet' || t.scope === 'global')),
    [tools],
  )
  const scripts = useMemo(() => tools.filter((t) => t.type === 'script'), [tools])

  const onNodesChange = useCallback((changes: NodeChange<WorkflowRFNode>[]) => {
    const removedIds = changes
      .filter(
        (c): c is NodeChange<WorkflowRFNode> & { type: 'remove'; id: string } =>
          c.type === 'remove',
      )
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
    <div className="flex-1 flex bg-black">
      <div className="flex-1 relative bg-black">
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
          <span className="mx-1 text-zinc-700">|</span>
          {selectedId && (
            <button
              onClick={() => onOpenTestRun({ scope: 'node', nodeId: selectedId })}
              className="px-3 py-1 border border-fuchsia-500/60 text-fuchsia-300 hover:bg-fuchsia-500/20"
              title="test the selected node in a sandbox worktree"
            >
              ▶ test node
            </button>
          )}
          <button
            onClick={() => onOpenTestRun({ scope: 'workflow' })}
            className="px-3 py-1 border border-fuchsia-500/60 text-fuchsia-300 hover:bg-fuchsia-500/20"
            title="test the whole workflow in a sandbox worktree"
          >
            ▶ test workflow
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
            onOpenToolEditor={openToolEditor}
            onCreateAgent={openCreateAgent}
          />
        ) : (
          <EmptyMessage>click a node to edit it, or use the palette to add one</EmptyMessage>
        )}
      </aside>
      {toolEditor && (
        <Suspense fallback={null}>
          <ToolEditorModal
            mode={toolEditor}
            planetId={planetId}
            library={tools}
            onClose={() => setToolEditor(null)}
            onSaved={(saved) => {
              setToolEditor(null)
              onRefreshTools()
              if (toolEditor.kind === 'create' && toolEditor.type === 'agent' && selectedId) {
                const agent = saved as AgentTool
                setNodes((nds) =>
                  nds.map((n) => {
                    if (n.id !== selectedId) return n
                    const current = n.data.node.agents ?? []
                    if (current.includes(agent.name)) return n
                    return {
                      ...n,
                      data: { node: { ...n.data.node, agents: [...current, agent.name] } },
                    }
                  }),
                )
                setDirty(true)
              }
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
