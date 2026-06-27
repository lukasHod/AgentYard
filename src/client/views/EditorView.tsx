import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { AgentSubNode } from './editor/AgentSubNode'
import { SkillSubNode } from './editor/SkillSubNode'
import { buildSubNodes, agentKey } from './editor/buildSubNodes'

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

const NODE_TYPES = {
  workflow: WorkflowNodeView,
  agentSub: AgentSubNode,
  skillSub: SkillSubNode,
}

function toRFNode(node: WorkflowNode): WorkflowRFNode {
  return { id: node.id, position: node.position, type: 'workflow', data: { node } }
}

function toRFEdge(e: { from: string; to: string }): RFEdge {
  return {
    id: `${e.from}->${e.to}`,
    source: e.from,
    sourceHandle: 'wf-out',
    target: e.to,
    targetHandle: 'wf-in',
    animated: true,
  }
}

function uniqueId(existing: Set<string>, base: string): string {
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

function isSubNodeId(id: string | undefined): boolean {
  return typeof id === 'string' && (id.startsWith('agent::') || id.startsWith('skill::'))
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
  // Sub-nodes are proper React state (not synthesized) so React Flow can drag them.
  const [subNodes, setSubNodes] = useState<RFNode[]>([])
  // subEdges is derived — not stored — so handle direction updates live as nodes are dragged

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toolEditor, setToolEditor] = useState<EditorMode | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [agentDetailMap, setAgentDetailMap] = useState<Record<string, AgentTool>>({})
  // visualLayout holds saved positions loaded from the workflow — used only as the
  // initial seed when building sub-nodes. Authoritative positions live in subNodes state.
  const visualLayoutRef = useRef<WorkflowGraph['visualLayout']>(undefined)
  // Track the active workflow id so we only reset sub-node state when switching workflows,
  // not on every save (which re-issues the workflow prop with the same id).
  const prevWorkflowId = useRef<number | null>(null)

  const fetchingAgents = useRef(new Set<string>())

  const openToolEditor = useCallback(
    async (t: ToolSummary) => {
      if (t.scope !== 'global' && t.scope !== 'planet') {
        pushToast('error', `'${t.name}' has scope=${t.scope}, which can't be edited here.`)
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
      setToolEditor({ kind: 'edit', type: t.type, scope: t.scope, initial: res.data.data as never })
    },
    [planetId],
  )

  const openToolEditorForAgent = useCallback(
    (agentName: string, _workflowNodeId: string) => {
      const agentSummary = tools.find((t) => t.type === 'agent' && t.name === agentName)
      if (agentSummary) openToolEditor(agentSummary)
      else pushToast('error', `Agent '${agentName}' not found in tool library — try refreshing.`)
    },
    [tools, openToolEditor],
  )

  const openCreateAgent = useCallback(() => {
    setToolEditor({ kind: 'create', type: 'agent', scope: planetId === null ? 'global' : 'planet' })
  }, [planetId])

  useEffect(() => {
    if (!workflow) return
    const isNewWorkflow = workflow.id !== prevWorkflowId.current
    prevWorkflowId.current = workflow.id
    visualLayoutRef.current = workflow.graph.visualLayout
    // Only reset nodes/edges/sub-nodes when switching to a different workflow.
    // On save, the parent re-issues the same workflow id — nodes are already
    // correct (we just saved them), so resetting would lose React Flow's
    // selection state and cause unnecessary flicker.
    if (isNewWorkflow) {
      setNodes(workflow.graph.nodes.map(toRFNode))
      setEdges(workflow.graph.edges.map(toRFEdge))
      setSubNodes([])
      setAgentDetailMap({})
      fetchingAgents.current = new Set()
    }
    setName(workflow.name)
    setDirty(false)
  }, [workflow])

  useEffect(() => { onRefreshTools() }, [onRefreshTools])

  // Autosave: 1.5 s after any unsaved change, save automatically.
  useEffect(() => {
    if (!dirty || saving) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      void handleSave()
    }, 1500)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, nodes, edges, subNodes, name])

  // Fetch full agent data for every agent referenced in the workflow.
  useEffect(() => {
    const allAgentNames = new Set(nodes.flatMap((n) => n.data.node.agents ?? []))
    for (const agentName of allAgentNames) {
      if (fetchingAgents.current.has(agentName) || agentDetailMap[agentName]) continue
      fetchingAgents.current.add(agentName)
      const agentSummary = tools.find((t) => t.type === 'agent' && t.name === agentName)
      if (!agentSummary) {
        // tools not yet loaded for this agent — allow retry on next effect run
        fetchingAgents.current.delete(agentName)
        continue
      }
      const url =
        agentSummary.scope === 'global' || planetId === null
          ? `/api/global-tools/agent/${encodeURIComponent(agentName)}`
          : `/api/planets/${planetId}/tools/${agentSummary.scope}/agent/${encodeURIComponent(agentName)}`
      apiGet<{ data: AgentTool }>(url).then((res) => {
        if (res.ok) setAgentDetailMap((prev) => ({ ...prev, [agentName]: res.data.data }))
        else fetchingAgents.current.delete(agentName)
      }).catch(() => { fetchingAgents.current.delete(agentName) })
    }
  }, [nodes, tools, planetId, agentDetailMap])

  // Topology key: tracks which agents (and their skills) are assigned.
  // Changes only when agents are added/removed or their skills change — not on position moves.
  const topologyKey = useMemo(
    () =>
      JSON.stringify(
        nodes.map((n) => ({
          id: n.id,
          agents: (n.data.node.agents ?? []).map((a) => ({
            name: a,
            skills: agentDetailMap[a]?.skills ?? [],
          })),
        })),
      ),
    [nodes, agentDetailMap],
  )

  // Rebuild sub-nodes when topology changes. Preserves positions for nodes that still exist.
  useEffect(() => {
    const { agentNodes, skillNodes } = buildSubNodes(
      nodes as Parameters<typeof buildSubNodes>[0],
      agentDetailMap,
      visualLayoutRef.current, // initial positions for NEW nodes only
    )
    const newSubNodeList = [...agentNodes, ...skillNodes]
    // Build a lookup of where buildSubNodes placed each agent so we can compute
    // the delta to the agent's live (potentially dragged) position below.
    const builtAgentPositions = new Map(agentNodes.map((a) => [a.id, a.position]))

    setSubNodes((prev) => {
      const prevPositions = new Map(prev.map((n) => [n.id, n.position]))
      return newSubNodeList.map((n) => {
        const existingPos = prevPositions.get(n.id)
        if (existingPos) return { ...n, position: existingPos }

        // For NEW skill nodes, anchor relative to the agent's current live position
        // so they appear near the agent even if it was dragged since the last save.
        if (n.id.startsWith('skill::')) {
          const parts = n.id.slice('skill::'.length).split('::')
          if (parts.length >= 3) {
            const agentNodeId = `agent::${parts[0]}::${parts[1]}`
            const currentAgentPos = prevPositions.get(agentNodeId)
            const builtAgentPos = builtAgentPositions.get(agentNodeId)
            if (currentAgentPos && builtAgentPos) {
              const dx = currentAgentPos.x - builtAgentPos.x
              const dy = currentAgentPos.y - builtAgentPos.y
              return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
            }
          }
        }

        return n
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey])

  // Derive sub-edges dynamically from live node positions.
  // This makes handle direction (top vs bottom) flip in real time as nodes are dragged.
  const subEdges = useMemo((): RFEdge[] => {
    const wfPositions = new Map(nodes.map((n) => [n.id, n.position]))
    const result: RFEdge[] = []

    for (const subNode of subNodes) {
      if (subNode.id.startsWith('agent::')) {
        // Parse: agent::workflowNodeId::agentName
        const key = subNode.id.slice('agent::'.length)
        const sepIdx = key.indexOf('::')
        if (sepIdx === -1) continue
        const workflowNodeId = key.slice(0, sepIdx)
        const parentPos = wfPositions.get(workflowNodeId)
        if (!parentPos) continue

        // Agent is "above" if its center Y is less than parent's center Y.
        const agentCenterY = subNode.position.y + 28  // approx half AgentSubNode height (~56px)
        const parentCenterY = parentPos.y + 40        // approx half WorkflowNodeView height (~80px)
        const agentIsAbove = agentCenterY < parentCenterY

        result.push({
          id: `wf-agent::${workflowNodeId}->${subNode.id}`,
          source: workflowNodeId,
          sourceHandle: agentIsAbove ? 'agents-top' : 'agents-bottom',
          target: subNode.id,
          targetHandle: agentIsAbove ? 'conn-bottom' : 'conn-top',
          animated: false,
          style: { stroke: '#7c3aed', strokeWidth: 1.5, strokeDasharray: '4 3' },
        })
      } else if (subNode.id.startsWith('skill::')) {
        // Parse: skill::workflowNodeId::agentName::skillName
        const key = subNode.id.slice('skill::'.length)
        const parts = key.split('::')
        if (parts.length < 3) continue
        const workflowNodeId = parts[0]!
        const agentName = parts[1]!
        const agentNodeId = `agent::${agentKey(workflowNodeId, agentName)}`
        result.push({
          id: `agent-skill::${agentNodeId}->${subNode.id}`,
          source: agentNodeId,
          sourceHandle: 'skill-out',
          target: subNode.id,
          targetHandle: 'skill-in',
          animated: false,
          style: { stroke: '#a21caf', strokeWidth: 1, strokeDasharray: '3 3' },
        })
      }
    }

    return result
  }, [nodes, subNodes])

  const agents = useMemo(
    () => tools.filter((t) => t.type === 'agent' && (t.scope === 'planet' || t.scope === 'global')),
    [tools],
  )
  const scripts = useMemo(() => tools.filter((t) => t.type === 'script'), [tools])

  const allNodes = useMemo(() => [...nodes, ...subNodes] as RFNode[], [nodes, subNodes])
  const allEdges = useMemo(() => [...edges, ...subEdges], [edges, subEdges])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Split changes: workflow nodes vs sub-nodes.
    const wfChanges = changes.filter((c) => !isSubNodeId((c as { id: string }).id))
    const subChanges = changes.filter(
      (c) => isSubNodeId((c as { id: string }).id) && c.type !== 'remove',
    )

    // Apply workflow node changes (position, select, dimensions, remove).
    const wfRemoves = wfChanges
      .filter((c): c is NodeChange & { type: 'remove'; id: string } => c.type === 'remove')
      .map((c) => c.id)

    setNodes((nds) => applyNodeChanges(wfChanges as NodeChange<WorkflowRFNode>[], nds))

    if (wfRemoves.length > 0) {
      setEdges((eds) => eds.filter((e) => !wfRemoves.includes(e.source) && !wfRemoves.includes(e.target)))
      setSelectedId((cur) => (cur && wfRemoves.includes(cur) ? null : cur))
      setDirty(true)
    } else if (wfChanges.some((c) => c.type === 'position' && !(c as { dragging?: boolean }).dragging)) {
      setDirty(true)
    }

    // Apply sub-node changes (position, select, dimensions) — this is what enables dragging.
    if (subChanges.length > 0) {
      setSubNodes((prev) => applyNodeChanges(subChanges, prev))
      if (subChanges.some((c) => c.type === 'position' && !(c as { dragging?: boolean }).dragging)) {
        setDirty(true)
      }
    }
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const filtered = changes.filter(
      (c) => !(c.type === 'remove' && (c.id.startsWith('wf-agent::') || c.id.startsWith('agent-skill::'))),
    )
    setEdges((eds) => applyEdgeChanges(filtered, eds))
    if (filtered.some((c) => c.type === 'remove')) setDirty(true)
  }, [])

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return
    if (isSubNodeId(conn.source) || isSubNodeId(conn.target)) return
    // Reject connections that originate from the agent-passthrough handles — those
    // are only wired to agent sub-nodes via subEdges and must not create wf→wf edges.
    if (conn.sourceHandle === 'agents-top' || conn.sourceHandle === 'agents-bottom') return
    setEdges((eds) => addEdge({ ...conn, id: `${conn.source}->${conn.target}`, animated: true }, eds))
    setDirty(true)
  }, [])

  const onNodeClick = useCallback(
    (_: unknown, n: RFNode) => {
      setSelectedId(n.id)
      if (n.id.startsWith('agent::')) {
        const key = n.id.slice('agent::'.length)
        const parts = key.split('::')
        if (parts.length >= 2) {
          openToolEditorForAgent(parts.slice(1).join('::'), parts[0] ?? '')
        }
      }
    },
    [openToolEditorForAgent],
  )
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
        return { ...n, data: { node: { ...n.data.node, ...patch } } }
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
        ? { id, title: 'New AI node', type: 'ai', position: { x: offsetX, y: offsetY }, prompt: '', agents: [] }
        : { id, title: 'New script node', type: 'custom', position: { x: offsetX, y: offsetY }, customType: 'script', args: {} }
    // Deselect all existing nodes and mark the new one as selected so React
    // Flow shows it with the selection ring and .react-flow__node.selected class.
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), { ...toRFNode(node), selected: true }])
    setSelectedId(id)
    setDirty(true)
  }

  function deleteSelected() {
    if (!selectedId || isSubNodeId(selectedId)) return
    const id = selectedId
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
    // Synchronously prune orphaned sub-nodes so they can't be clicked after deletion.
    setSubNodes((prev) =>
      prev.filter((sn) => !sn.id.startsWith(`agent::${id}::`) && !sn.id.startsWith(`skill::${id}::`)),
    )
    setSelectedId(null)
    setDirty(true)
  }

  async function handleSave() {
    if (!workflow) return
    setSaving(true)
    // Compute visualLayout from current subNodes positions at save time.
    const agentPositions: Record<string, { x: number; y: number }> = {}
    const skillPositions: Record<string, { x: number; y: number }> = {}
    for (const n of subNodes) {
      if (n.id.startsWith('agent::')) agentPositions[n.id.slice('agent::'.length)] = n.position
      else if (n.id.startsWith('skill::')) skillPositions[n.id.slice('skill::'.length)] = n.position
    }
    const graph: WorkflowGraph = {
      nodes: nodes.map((n) => ({ ...n.data.node, position: n.position })),
      edges: edges.map((e) => ({ from: e.source, to: e.target })),
      visualLayout: { agents: agentPositions, skills: skillPositions },
    }
    try {
      await onSave({ ...workflow, name, graph })
      visualLayoutRef.current = graph.visualLayout
      setDirty(false)
    } catch {
      // onSave throws on failure (caller shows the toast); keep dirty=true so user can retry.
    } finally {
      setSaving(false)
    }
  }

  if (!workflow) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
        // loading workflow...
      </div>
    )
  }

  const canDelete = selectedId && !isSubNodeId(selectedId)

  return (
    <div className="flex-1 flex bg-black">
      <div className="flex-1 relative bg-black">
        <div className="absolute top-2 left-2 z-10 flex items-center gap-2 text-xs">
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true) }}
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
          <button onClick={() => addNode('ai')} className="px-3 py-1 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-500/20">
            + AI node
          </button>
          <button onClick={() => addNode('custom')} className="px-3 py-1 border border-amber-500/60 text-amber-300 hover:bg-amber-500/20">
            + script node
          </button>
          {canDelete && (
            <button
              onClick={deleteSelected}
              className="px-3 py-1 border border-rose-500/60 text-rose-300 hover:bg-rose-500/20"
              title="delete selected node (and connected edges)"
            >
              delete
            </button>
          )}
          <span className="mx-1 text-zinc-700">|</span>
          {selectedId && !isSubNodeId(selectedId) && (
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
            nodes={allNodes}
            edges={allEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={NODE_TYPES}
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
              if (toolEditor.kind === 'create' && toolEditor.type === 'agent' && selectedId && !isSubNodeId(selectedId)) {
                const agent = saved as AgentTool
                setNodes((nds) =>
                  nds.map((n) => {
                    if (n.id !== selectedId) return n
                    const current = n.data.node.agents ?? []
                    if (current.includes(agent.name)) return n
                    return { ...n, data: { node: { ...n.data.node, agents: [...current, agent.name] } } }
                  }),
                )
                setDirty(true)
              }
              if (toolEditor.kind === 'edit' && toolEditor.type === 'agent') {
                const agent = saved as AgentTool
                setAgentDetailMap((prev) => ({ ...prev, [agent.name]: agent }))
              }
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
