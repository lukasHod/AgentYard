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
  created_at   INTEGER NOT NULL
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
  status        TEXT NOT NULL DEFAULT 'pending',
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
`

export type DB = Database.Database

let _db: DB | null = null

function tableExists(db: DB, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name)
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

export function getDb(): DB {
  if (_db) return _db
  mkdirSync(DB_DIR, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runRenameMigration(db)
  db.exec(SCHEMA)
  _db = db
  return db
}

export function closeDb() {
  _db?.close()
  _db = null
}
