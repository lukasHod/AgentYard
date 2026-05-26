import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DB_DIR = path.join(homedir(), '.agentyard')
const DB_PATH = path.join(DB_DIR, 'agentyard.db')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ships (
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
  ship_id       INTEGER NOT NULL,
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

CREATE TABLE IF NOT EXISTS ship_chat_messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ship_id   INTEGER NOT NULL,
  role      TEXT NOT NULL,
  content   TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ship_chat_messages_ship
  ON ship_chat_messages(ship_id, id);
`

export type DB = Database.Database

let _db: DB | null = null

export function getDb(): DB {
  if (_db) return _db
  mkdirSync(DB_DIR, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  _db = db
  return db
}

export function closeDb() {
  _db?.close()
  _db = null
}
