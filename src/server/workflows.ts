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
 * Pre-C default workflow shape (3 AI nodes: analyze→develop→deploy, no script
 * node). If a row matches this exact signature, it's an untouched default from
 * the B era and gets reseeded with the C default (which adds print-context).
 * Any custom edits drop us out of this signature and we leave the row alone.
 */
function looksLikePreCDefault(graph: unknown): boolean {
  if (typeof graph !== 'object' || graph === null) return false
  const g = graph as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return false
  if (g.nodes.length !== 3 || g.edges.length !== 2) return false
  const ids = (g.nodes as { id?: unknown; type?: unknown }[]).map((n) => n.id).sort()
  if (JSON.stringify(ids) !== JSON.stringify(['analyze', 'deploy', 'develop'])) return false
  return (g.nodes as { type?: unknown }[]).every((n) => n.type === 'ai')
}

/**
 * Migration:
 *  - Pre-B rows (kind/drones/skills) fail to parse → wipe & reseed.
 *  - Pre-C rows that match the exact B default signature → reseed (devs get
 *    the new print-context node for free, but user customizations survive).
 *  - Everything else → leave alone.
 */
export function ensureDefaultWorkflow(): Workflow {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM workflows ORDER BY id').all() as WorkflowRow[]

  let needsReseed = rows.length === 0
  for (const row of rows) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.graph_json)
      WorkflowGraphSchema.parse(parsed)
    } catch {
      needsReseed = true
      break
    }
    if (looksLikePreCDefault(parsed)) {
      needsReseed = true
      break
    }
  }

  if (needsReseed && rows.length > 0) {
    // Workflow rows about to be dropped — also remove any feature rows that
    // referenced them. features.workflow_id is NOT NULL so we can't detach;
    // these features couldn't run against the new default anyway.
    const oldIds = rows.map((r) => r.id)
    const placeholders = oldIds.map(() => '?').join(',')
    db.prepare(`DELETE FROM features WHERE workflow_id IN (${placeholders})`).run(...oldIds)
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
