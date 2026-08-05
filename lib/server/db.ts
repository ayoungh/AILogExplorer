import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

declare global {
  var __aiLogDatabase: Database.Database | undefined;
}

function databasePath() {
  return process.env.AILOG_DB_PATH || path.join(process.cwd(), ".data", "ailogexplorer.sqlite");
}

function migrate(db: Database.Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -131072;
    PRAGMA temp_store = MEMORY;
    PRAGMA mmap_size = 1073741824;
    PRAGMA wal_autocheckpoint = 10000;

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'empty',
      note TEXT,
      last_scan_at TEXT
    );

    CREATE TABLE IF NOT EXISTS source_files (
      path TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms REAL NOT NULL,
      fingerprint TEXT NOT NULL,
      available INTEGER NOT NULL DEFAULT 1,
      last_indexed_at TEXT NOT NULL,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      project_path TEXT,
      source_path TEXT NOT NULL,
      started_at TEXT,
      updated_at TEXT,
      model TEXT,
      available INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT,
      event_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(provider, external_id)
    );

    CREATE INDEX IF NOT EXISTS sessions_provider_updated_idx ON sessions(provider, updated_at DESC);
    CREATE INDEX IF NOT EXISTS sessions_source_path_idx ON sessions(source_path);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      timestamp TEXT,
      kind TEXT NOT NULL,
      role TEXT,
      turn_id TEXT,
      call_id TEXT,
      parent_id TEXT,
      tool_name TEXT,
      text TEXT,
      input_json TEXT,
      output_json TEXT,
      status TEXT,
      duration_ms REAL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      canonical_key TEXT,
      raw_payload BLOB NOT NULL,
      raw_encoding TEXT NOT NULL,
      raw_bytes INTEGER NOT NULL,
      raw_record_count INTEGER NOT NULL DEFAULT 1,
      UNIQUE(session_id, sequence)
    );

    CREATE INDEX IF NOT EXISTS events_session_sequence_idx ON events(session_id, sequence);
    CREATE INDEX IF NOT EXISTS events_session_kind_idx ON events(session_id, kind, sequence);
    CREATE INDEX IF NOT EXISTS events_call_id_idx ON events(call_id);

    CREATE TABLE IF NOT EXISTS session_event_stats (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      event_count INTEGER NOT NULL,
      timestamp_count INTEGER NOT NULL DEFAULT 0,
      role_count INTEGER NOT NULL DEFAULT 0,
      turn_id_count INTEGER NOT NULL DEFAULT 0,
      call_id_count INTEGER NOT NULL DEFAULT 0,
      parent_id_count INTEGER NOT NULL DEFAULT 0,
      tool_name_count INTEGER NOT NULL DEFAULT 0,
      text_count INTEGER NOT NULL DEFAULT 0,
      input_count INTEGER NOT NULL DEFAULT 0,
      output_count INTEGER NOT NULL DEFAULT 0,
      status_count INTEGER NOT NULL DEFAULT 0,
      duration_ms_count INTEGER NOT NULL DEFAULT 0,
      input_tokens_count INTEGER NOT NULL DEFAULT 0,
      output_tokens_count INTEGER NOT NULL DEFAULT 0,
      total_tokens_count INTEGER NOT NULL DEFAULT 0,
      sample_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
      PRIMARY KEY (session_id, kind)
    );

    CREATE INDEX IF NOT EXISTS session_event_stats_kind_idx ON session_event_stats(kind, session_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS event_fts USING fts5(
      event_id UNINDEXED,
      session_id UNINDEXED,
      provider UNINDEXED,
      content,
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      processed_files INTEGER NOT NULL DEFAULT 0,
      total_files INTEGER NOT NULL DEFAULT 0,
      processed_events INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS diagnostics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      provider TEXT,
      source_path TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      line INTEGER,
      created_at TEXT NOT NULL
    );
  `);

  const insert = db.prepare("INSERT OR IGNORE INTO sources (id, label) VALUES (?, ?)");
  const sources = [
    ["claude-code", "Claude Code"],
    ["claude-desktop", "Claude Desktop"],
    ["codex", "Codex"],
    ["cursor", "Cursor"],
    ["chatgpt", "ChatGPT"],
    ["claude-export", "Claude export"],
  ];
  db.transaction(() => sources.forEach((source) => insert.run(...source)))();

}

export function getDb() {
  if (!global.__aiLogDatabase) {
    const dbPath = databasePath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    global.__aiLogDatabase = new Database(dbPath);
    migrate(global.__aiLogDatabase);
  }
  return global.__aiLogDatabase;
}

export function closeDb() {
  global.__aiLogDatabase?.close();
  global.__aiLogDatabase = undefined;
}

export function resetDb() {
  const db = getDb();
  db.exec(`
    DELETE FROM event_fts;
    DELETE FROM session_event_stats;
    DELETE FROM events;
    DELETE FROM sessions;
    DELETE FROM source_files;
    DELETE FROM diagnostics;
    DELETE FROM jobs;
    UPDATE sources SET status='empty', note=NULL, last_scan_at=NULL;
  `);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM");
}

