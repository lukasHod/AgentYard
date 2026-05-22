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

/**
 * Phase B migration: the WorkflowNode shape changed (kind/drones/skills →
 * type/agents/customType/scriptName/args). Any pre-B rows are incompatible,
 * so we wipe & reseed. Detect pre-B rows by attempting to parse — if it fails,
 * drop everything and reseed. New installs hit the empty branch immediately.
 */
export function ensureDefaultWorkflow(): Workflow {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM workflows ORDER BY id').all() as WorkflowRow[]

  let needsReseed = rows.length === 0
  for (const row of rows) {
    try {
      WorkflowGraphSchema.parse(JSON.parse(row.graph_json))
    } catch {
      needsReseed = true
      break
    }
  }

  if (needsReseed && rows.length > 0) {
    // Detach features from the now-invalid workflow rows, then drop them.
    db.prepare('UPDATE features SET workflow_id = NULL WHERE workflow_id IS NOT NULL').run()
    db.prepare('DELETE FROM workflows').run()
  }

  if (needsReseed) {
    const stmt = db.prepare(
      'INSERT INTO workflows (name, graph_json, is_template) VALUES (?, ?, ?)',
    )
    const info = stmt.run(
      'Default analyze → develop → deploy',
      JSON.stringify(DEFAULT_WORKFLOW_GRAPH),
      1,
    )
    const row = db
      .prepare('SELECT * FROM workflows WHERE id = ?')
      .get(info.lastInsertRowid) as WorkflowRow
    return rowToWorkflow(row)
  }

  return rowToWorkflow(rows[0]!)
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
