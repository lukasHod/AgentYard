import { getDb } from './db.js'
import {
  AO_WORKFLOW_GRAPH,
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

/**
 * First-boot seed. Inserts the simple analyze/develop/deploy template plus
 * the Phase 8a AO-style template (`AO development lifecycle`). The AO
 * template is preferred as the default for newly created features; the
 * simple template stays around as a fallback the user can edit.
 *
 * Idempotent: if either template is missing on a later boot (e.g. deleted
 * from the DB), we re-seed it. Existing features keep whatever workflow
 * they were created with.
 */
export function ensureDefaultWorkflow(): Workflow {
  ensureNamedWorkflow('Default analyze → develop → deploy', DEFAULT_WORKFLOW_GRAPH)
  return ensureNamedWorkflow('AO development lifecycle', AO_WORKFLOW_GRAPH)
}

/**
 * Lookup-or-insert a workflow row by name. Returns the parsed Workflow.
 * Used by `ensureDefaultWorkflow` + new-feature creation to pick a
 * deterministic default per-row without touching unrelated rows.
 */
export function ensureNamedWorkflow(name: string, graph: WorkflowGraph): Workflow {
  const db = getDb()
  const existingRow = db
    .prepare('SELECT * FROM workflows WHERE name = ? LIMIT 1')
    .get(name) as WorkflowRow | undefined
  if (existingRow) {
    const parsed = tryRowToWorkflow(existingRow)
    if (parsed) return parsed
  }
  const info = db
    .prepare('INSERT INTO workflows (name, graph_json, is_template) VALUES (?, ?, ?)')
    .run(name, JSON.stringify(graph), 1)
  const newRow = db
    .prepare('SELECT * FROM workflows WHERE id = ?')
    .get(info.lastInsertRowid) as WorkflowRow
  return rowToWorkflow(newRow)
}

/**
 * Workflow id used as the default when creating a new feature. Falls back
 * to the simple template if AO isn't seeded (shouldn't happen — boot
 * seeds both — but defensive in case of manual DB tinkering).
 */
export function getDefaultWorkflowIdForNewFeatures(): number {
  const db = getDb()
  const ao = db
    .prepare('SELECT id FROM workflows WHERE name = ? LIMIT 1')
    .get('AO development lifecycle') as { id: number } | undefined
  if (ao) return ao.id
  const simple = db
    .prepare('SELECT id FROM workflows WHERE name = ? LIMIT 1')
    .get('Default analyze → develop → deploy') as { id: number } | undefined
  if (simple) return simple.id
  // Last resort: first row.
  const any = db.prepare('SELECT id FROM workflows ORDER BY id LIMIT 1').get() as
    | { id: number }
    | undefined
  if (!any) throw new Error('No workflow seeded; cannot pick default')
  return any.id
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
