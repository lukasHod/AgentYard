import type Database from 'better-sqlite3'
import { getDb } from './db.js'

/**
 * Tiny typed SELECT helper for the snake_case ↔ camelCase entity modules
 * (features, ships). Each entity supplies a `Row` interface (raw DB shape)
 * and a `toEntity` mapper; the helper provides `all` / `one` that prepare
 * a statement, run it, and map every row — replacing the recurring
 * `db.prepare(...).all() as Row[]` cast pattern.
 *
 * Mutations (INSERT/UPDATE/DELETE) stay in the entity modules where the
 * validation and SQL shape vary per-table — there's no win in abstracting
 * them generically.
 */
export interface Repo<Row, Entity> {
  /** `SELECT` returning many rows. */
  all(sql: string, ...params: unknown[]): Entity[]
  /** `SELECT` returning one row, or `undefined` if not found. */
  one(sql: string, ...params: unknown[]): Entity | undefined
  /** Escape hatch for raw mutations (INSERT/UPDATE/DELETE). */
  db(): Database.Database
}

export function createRepo<Row, Entity>(toEntity: (row: Row) => Entity): Repo<Row, Entity> {
  return {
    all(sql, ...params) {
      const rows = getDb().prepare(sql).all(...params) as Row[]
      return rows.map(toEntity)
    },
    one(sql, ...params) {
      const row = getDb().prepare(sql).get(...params) as Row | undefined
      return row ? toEntity(row) : undefined
    },
    db: getDb,
  }
}
