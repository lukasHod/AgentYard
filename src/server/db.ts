import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/**
 * The path the next `getDb()` call should open. Computed lazily so tests
 * can override via `setDbPathForTesting` before the singleton is initialised.
 */
let _overridePath: string | null = null

function dbDir(): string {
  if (_overridePath) return path.dirname(_overridePath)
  return path.join(homedir(), '.agentyard')
}
function dbPath(): string {
  return _overridePath ?? path.join(dbDir(), 'agentyard.db')
}

/**
 * Point `getDb()` at a different file. Intended for unit tests using a tmp
 * directory; pass `null` to revert to the default `~/.agentyard/agentyard.db`.
 * Closes any open DB connection so the next call opens the new path.
 */
export function setDbPathForTesting(p: string | null): void {
  closeDb()
  _overridePath = p
}

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

-- ── Phase 4 runner persistence ──────────────────────────────────────────
-- See docs/backend-runner-scheduler-plan.md for the design. runner_events
-- is the source of truth; the snapshot tables exist for fast UI reads and
-- are rebuildable by replaying events.

CREATE TABLE IF NOT EXISTS runs (
  id              TEXT PRIMARY KEY,
  feature_id      INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  workflow_id     INTEGER NOT NULL,
  task            TEXT NOT NULL,
  agent_kind      TEXT NOT NULL DEFAULT 'claude-sdk',
  state           TEXT NOT NULL DEFAULT 'not_started',
  reason          TEXT,
  final_summary   TEXT,
  error           TEXT,
  cwd             TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_feature ON runs(feature_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_state ON runs(state);

CREATE TABLE IF NOT EXISTS node_runs (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  node_id       TEXT NOT NULL,
  title         TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'pending',
  summary       TEXT,
  outputs_json  TEXT,
  started_at    INTEGER,
  ended_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_node_runs_run ON node_runs(run_id);

CREATE TABLE IF NOT EXISTS runner_sessions (
  id            TEXT PRIMARY KEY,
  run_id        TEXT REFERENCES runs(id) ON DELETE CASCADE,
  node_run_id   TEXT REFERENCES node_runs(id) ON DELETE CASCADE,
  feature_id    INTEGER REFERENCES features(id) ON DELETE CASCADE,
  planet_id     INTEGER REFERENCES planets(id) ON DELETE CASCADE,
  agent_kind    TEXT NOT NULL,
  runtime_kind  TEXT NOT NULL,
  role          TEXT NOT NULL,
  label         TEXT,
  state         TEXT NOT NULL DEFAULT 'not_started',
  reason        TEXT,
  pid           INTEGER,
  pipe_path     TEXT,
  cwd           TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runner_sessions_run ON runner_sessions(run_id);
CREATE INDEX IF NOT EXISTS idx_runner_sessions_feature ON runner_sessions(feature_id);
CREATE INDEX IF NOT EXISTS idx_runner_sessions_planet ON runner_sessions(planet_id);
CREATE INDEX IF NOT EXISTS idx_runner_sessions_state ON runner_sessions(state);

CREATE TABLE IF NOT EXISTS runner_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL REFERENCES runner_sessions(id) ON DELETE CASCADE,
  ts             INTEGER NOT NULL,
  type           TEXT NOT NULL,
  payload_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runner_events_session ON runner_events(session_id, id);

CREATE TABLE IF NOT EXISTS terminal_sessions (
  id              TEXT PRIMARY KEY,
  profile_id      TEXT NOT NULL,
  runtime_kind    TEXT NOT NULL DEFAULT 'pty',
  planet_id       INTEGER REFERENCES planets(id) ON DELETE CASCADE,
  feature_id      INTEGER REFERENCES features(id) ON DELETE CASCADE,
  workflow_run_id TEXT,
  node_run_id     TEXT,
  agent_session_id TEXT,
  role            TEXT,
  cwd             TEXT,
  argv_json       TEXT NOT NULL,
  env_json        TEXT,
  state           TEXT NOT NULL DEFAULT 'running',
  exit_code       INTEGER,
  exit_signal     INTEGER,
  pid             INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_started_at INTEGER,
  last_exited_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_feature ON terminal_sessions(feature_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_planet ON terminal_sessions(planet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_state ON terminal_sessions(state);

CREATE TABLE IF NOT EXISTS terminal_transcript_chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES terminal_sessions(id) ON DELETE CASCADE,
  ts          INTEGER NOT NULL,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_terminal_transcript_chunks_session
  ON terminal_transcript_chunks(session_id, id);
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

function runAddPlanetDefaultAgentKindMigration(db: DB) {
  if (tableExists(db, 'planets') && !columnExists(db, 'planets', 'default_agent_kind')) {
    // Phase 6: per-planet default agent backend. Null = inherit from global.
    db.exec(`ALTER TABLE planets ADD COLUMN default_agent_kind TEXT`)
  }
}

function runAddFeatureDefaultAgentKindMigration(db: DB) {
  if (tableExists(db, 'features') && !columnExists(db, 'features', 'default_agent_kind')) {
    // Phase 6: per-feature default agent backend. Null = inherit from planet.
    db.exec(`ALTER TABLE features ADD COLUMN default_agent_kind TEXT`)
  }
}

export function getDb(): DB {
  if (_db) return _db
  mkdirSync(dbDir(), { recursive: true })
  const db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runRenameMigration(db)
  db.exec(SCHEMA)
  runAddTextureMigration(db)
  runAddHasCloudsMigration(db)
  runAddHandoffContextMigration(db)
  runAddDescriptionMigration(db)
  runAddChatNameMigration(db)
  runAddPlanetDefaultAgentKindMigration(db)
  runAddFeatureDefaultAgentKindMigration(db)
  _db = db
  return db
}

export function closeDb() {
  _db?.close()
  _db = null
}
