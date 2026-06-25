import { getDb } from './db.js'

/** Generic per-planet key/value settings store, backing `Planet.settings`. */

export function getPlanetSetting(planetId: number, key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM planet_settings WHERE planet_id = ? AND key = ?')
    .get(planetId, key) as { value: string | null } | undefined
  return row?.value ?? null
}

export function getPlanetSettings(planetId: number): Record<string, string> {
  const rows = getDb()
    .prepare('SELECT key, value FROM planet_settings WHERE planet_id = ?')
    .all(planetId) as { key: string; value: string | null }[]
  const out: Record<string, string> = {}
  for (const row of rows) {
    if (row.value !== null) out[row.key] = row.value
  }
  return out
}

export function setPlanetSetting(planetId: number, key: string, value: string | null): void {
  const db = getDb()
  if (value === null) {
    db.prepare('DELETE FROM planet_settings WHERE planet_id = ? AND key = ?').run(planetId, key)
    return
  }
  db.prepare(
    `INSERT INTO planet_settings (planet_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(planet_id, key) DO UPDATE SET value = excluded.value`,
  ).run(planetId, key, value)
}
