import { createHash } from 'node:crypto'
import type { Workflow } from '../core/schema.js'

export interface WorkflowSnapshot {
  json: string
  /** First 12 hex chars of SHA-256 of json — stable identifier for this graph state. */
  hash: string
}

/**
 * Produce an immutable, deterministic snapshot of a workflow's graph.
 * Fields that change at runtime (UI positions, etc.) are excluded;
 * only the execution-relevant shape is captured.
 */
export function snapshotWorkflow(workflow: Workflow): WorkflowSnapshot {
  const obj = {
    id: workflow.id,
    name: workflow.name,
    graph: {
      nodes: workflow.graph.nodes
        .map((n) => ({
          id: n.id,
          title: n.title,
          type: n.type,
          ...(n.prompt !== undefined ? { prompt: n.prompt } : {}),
          ...(n.agents !== undefined ? { agents: n.agents } : {}),
          ...(n.customType !== undefined ? { customType: n.customType } : {}),
          ...(n.scriptName !== undefined ? { scriptName: n.scriptName } : {}),
          ...(n.args !== undefined ? { args: n.args } : {}),
          ...(n.agentKind !== undefined ? { agentKind: n.agentKind } : {}),
          ...(n.reviewLoop !== undefined ? { reviewLoop: n.reviewLoop } : {}),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      edges: workflow.graph.edges
        .slice()
        .sort((a, b) => `${a.from}\x00${a.to}`.localeCompare(`${b.from}\x00${b.to}`)),
    },
  }
  const json = JSON.stringify(obj)
  const hash = createHash('sha256').update(json).digest('hex').slice(0, 12)
  return { json, hash }
}
