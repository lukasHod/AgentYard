import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DB_DIR = path.join(homedir(), '.agentyard')
const DB_PATH = path.join(DB_DIR, 'agentyard.db')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS planets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  project_path TEXT NOT NULL,
  workflow_id  INTEGER,
  state        TEXT NOT NULL DEFAULT 'idle',
  created_at   INTEGER NOT NULL,
  texture      TEXT NOT NULL,
  has_clouds   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workflows (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  graph_json  TEXT NOT NULL,
  is_template INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS features (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  planet_id     INTEGER NOT NULL,
  name          TEXT NOT NULL,
  task          TEXT NOT NULL DEFAULT '',
  branch        TEXT,
  worktree_path TEXT,
  status        TEXT NOT NULL DEFAULT 'idle',
  workflow_id   INTEGER NOT NULL DEFAULT 1,
  final_summary TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS planet_chat_messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  planet_id INTEGER NOT NULL,
  role      TEXT NOT NULL,
  content   TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planet_chat_messages_planet
  ON planet_chat_messages(planet_id, id);

CREATE TABLE IF NOT EXISTS feature_chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  timestamp  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feature_chat_messages_feature
  ON feature_chat_messages (feature_id, id);
`

export type DB = Database.Database

let _db: DB | null = null

function tableExists(db: DB, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name)
}

function columnExists(db: DB, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((r) => r.name === column)
}

function runRenameMigration(db: DB) {
  // Only act if the legacy `ships` table exists AND `planets` doesn't.
  if (tableExists(db, 'ships') && !tableExists(db, 'planets')) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE ships RENAME TO planets;
        ALTER TABLE features RENAME COLUMN ship_id TO planet_id;
        ALTER TABLE ship_chat_messages RENAME TO planet_chat_messages;
        ALTER TABLE planet_chat_messages RENAME COLUMN ship_id TO planet_id;
        DROP INDEX IF EXISTS idx_ship_chat_messages_ship;
        CREATE INDEX IF NOT EXISTS idx_planet_chat_messages_planet
          ON planet_chat_messages(planet_id, id);
      `)
    })()
  }
}

function runAddTextureMigration(db: DB) {
  if (tableExists(db, 'planets') && !columnExists(db, 'planets', 'texture')) {
    db.exec(`ALTER TABLE planets ADD COLUMN texture TEXT`)
  }
}

function runAddHasCloudsMigration(db: DB) {
  if (tableExists(db, 'planets') && !columnExists(db, 'planets', 'has_clouds')) {
    db.exec(`ALTER TABLE planets ADD COLUMN has_clouds INTEGER NOT NULL DEFAULT 0`)
  }
}

function runAddHandoffContextMigration(db: DB) {
  if (tableExists(db, 'features') && !columnExists(db, 'features', 'handoff_context')) {
    db.exec(`ALTER TABLE features ADD COLUMN handoff_context TEXT`)
  }
}

function runAddDescriptionMigration(db: DB) {
  if (tableExists(db, 'features') && !columnExists(db, 'features', 'description')) {
    db.exec(`ALTER TABLE features ADD COLUMN description TEXT`)
  }
}

function runAddChatNameMigration(db: DB) {
  if (tableExists(db, 'features') && !columnExists(db, 'features', 'chat_name')) {
    db.exec(`ALTER TABLE features ADD COLUMN chat_name TEXT`)
  }
}

export function getDb(): DB {
  if (_db) return _db
  mkdirSync(DB_DIR, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runRenameMigration(db)
  db.exec(SCHEMA)
  runAddTextureMigration(db)
  runAddHasCloudsMigration(db)
  runAddHandoffContextMigration(db)
  runAddDescriptionMigration(db)
  runAddChatNameMigration(db)
  _db = db
  return db
}

export function closeDb() {
  _db?.close()
  _db = null
}
