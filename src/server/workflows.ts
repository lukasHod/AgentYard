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
 * Parse a row but never throw — bad rows just become null and get filtered
 * out by callers. Lets a single corrupt graph_json not 500 the whole list
 * endpoint.
 */
function tryRowToWorkflow(row: WorkflowRow): Workflow | null {
  try {
    return rowToWorkflow(row)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `workflows: row id=${row.id} (${row.name}) failed to parse; skipping. ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return null
  }
}

/** First-boot seed: returns the first existing workflow, or inserts the default. */
export function ensureDefaultWorkflow(): Workflow {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM workflows ORDER BY id').all() as WorkflowRow[]
  for (const row of rows) {
    const parsed = tryRowToWorkflow(row)
    if (parsed) return parsed
  }
  const info = db
    .prepare('INSERT INTO workflows (name, graph_json, is_template) VALUES (?, ?, ?)')
    .run('Default analyze → develop → deploy', JSON.stringify(DEFAULT_WORKFLOW_GRAPH), 1)
  const newRow = db
    .prepare('SELECT * FROM workflows WHERE id = ?')
    .get(info.lastInsertRowid) as WorkflowRow
  return rowToWorkflow(newRow)
}

export function listWorkflows(): Workflow[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM workflows ORDER BY id').all() as WorkflowRow[]
  return rows.map(tryRowToWorkflow).filter((w): w is Workflow => w !== null)
}

export function getWorkflow(id: number): Workflow | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRow | undefined
  if (!row) return undefined
  return tryRowToWorkflow(row) ?? undefined
}

export function updateWorkflow(
  id: number,
  patch: { name?: string; graph?: WorkflowGraph },
): Workflow | undefined {
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
