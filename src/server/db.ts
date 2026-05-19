import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DB_DIR = path.join(homedir(), '.agentyard')
const DB_PATH = path.join(DB_DIR, 'agentyard.db')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

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

CREATE TABLE IF NOT EXISTS skills (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  path        TEXT NOT NULL,
  description TEXT,
  source      TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  config_json TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS node_skills (
  node_id  TEXT NOT NULL,
  skill_id INTEGER NOT NULL,
  PRIMARY KEY (node_id, skill_id)
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

CREATE TABLE IF NOT EXISTS agent_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id  INTEGER NOT NULL,
  node_id     TEXT NOT NULL,
  role        TEXT NOT NULL,
  skills_json TEXT,
  status      TEXT NOT NULL DEFAULT 'idle',
  output_json TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_run_id INTEGER NOT NULL,
  role         TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  is_clarification_request INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clarifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_run_id INTEGER NOT NULL,
  tool_use_id  TEXT NOT NULL UNIQUE,
  question     TEXT NOT NULL,
  answer       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  requested_at INTEGER NOT NULL
);
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
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined
  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1)
  }
  _db = db
  return db
}

export function closeDb() {
  _db?.close()
  _db = null
}
