import { getDb } from './db.js'
import {
  DEFAULT_WORKFLOW_GRAPH,
  WorkflowGraphSchema,
  WorkflowSchema,
  type Workflow,
  type WorkflowGraph,
} from '../core/schema.js'

interface WorkflowRow {
  id: number
  name: string
  graph_json: string
  is_template: number
}

function rowToWorkflow(row: WorkflowRow): Workflow {
  const graph = WorkflowGraphSchema.parse(JSON.parse(row.graph_json))
  return WorkflowSchema.parse({
    id: row.id,
    name: row.name,
    graph,
    isTemplate: row.is_template === 1,
  })
}

export function ensureDefaultWorkflow(): Workflow {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM workflows ORDER BY id LIMIT 1').get() as WorkflowRow | undefined
  if (existing) return rowToWorkflow(existing)
  const stmt = db.prepare(
    'INSERT INTO workflows (name, graph_json, is_template) VALUES (?, ?, ?)',
  )
  const info = stmt.run('Default analyze → develop → deploy', JSON.stringify(DEFAULT_WORKFLOW_GRAPH), 1)
  const row = db
    .prepare('SELECT * FROM workflows WHERE id = ?')
    .get(info.lastInsertRowid) as WorkflowRow
  return rowToWorkflow(row)
}

export function listWorkflows(): Workflow[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM workflows ORDER BY id').all() as WorkflowRow[]
  return rows.map(rowToWorkflow)
}

export function getWorkflow(id: number): Workflow | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRow | undefined
  return row ? rowToWorkflow(row) : undefined
}

export function updateWorkflow(id: number, patch: { name?: string; graph?: WorkflowGraph }): Workflow | undefined {
  const db = getDb()
  const cur = getWorkflow(id)
  if (!cur) return undefined
  const name = patch.name ?? cur.name
  const graph = patch.graph ?? cur.graph
  WorkflowGraphSchema.parse(graph)
  db.prepare('UPDATE workflows SET name = ?, graph_json = ? WHERE id = ?').run(
    name,
    JSON.stringify(graph),
    id,
  )
  return getWorkflow(id)
}
