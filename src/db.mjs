import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Bump when the schema changes: the database is then rebuilt from the archive.
export const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE files(id INTEGER PRIMARY KEY, provider TEXT, path TEXT, kind TEXT, session_id TEXT, agent_id TEXT,
  generation INTEGER DEFAULT 0, offset INTEGER DEFAULT 0, lines INTEGER DEFAULT 0, head_hash TEXT,
  archive_size INTEGER DEFAULT 0, first_ts TEXT, own_first TEXT, own_last TEXT, cwd TEXT, live INTEGER DEFAULT 1,
  UNIQUE(provider, path));
CREATE TABLE records(uuid TEXT PRIMARY KEY, file_id INTEGER, line INTEGER, type TEXT, ts TEXT);
CREATE INDEX records_file ON records(file_id);
CREATE TABLE requests(message_id TEXT PRIMARY KEY, file_id INTEGER, line INTEGER, session_id TEXT, agent_id TEXT,
  ts TEXT, day TEXT, hour INTEGER, model TEXT, family TEXT, effort TEXT, is_sub INTEGER,
  input INTEGER, output INTEGER, thinking INTEGER, cache_read INTEGER, cache_write INTEGER, cache_write_1h INTEGER);
CREATE INDEX requests_session ON requests(session_id);
CREATE INDEX requests_day ON requests(day);
CREATE TABLE repeats(file_id INTEGER, message_id TEXT, PRIMARY KEY(file_id, message_id));
CREATE TABLE owner_messages(uuid TEXT PRIMARY KEY, file_id INTEGER, line INTEGER, session_id TEXT, ts TEXT,
  kind TEXT, text TEXT);
CREATE INDEX owner_messages_session ON owner_messages(session_id);
CREATE VIRTUAL TABLE owner_text USING fts5(text, content='owner_messages', content_rowid='rowid',
  tokenize="unicode61 remove_diacritics 2");
CREATE TRIGGER owner_messages_ai AFTER INSERT ON owner_messages BEGIN
  INSERT INTO owner_text(rowid, text) VALUES (new.rowid, new.text); END;
CREATE TRIGGER owner_messages_ad AFTER DELETE ON owner_messages BEGIN
  INSERT INTO owner_text(owner_text, rowid, text) VALUES ('delete', old.rowid, old.text); END;
CREATE TABLE tool_calls(id TEXT PRIMARY KEY, file_id INTEGER, line INTEGER, session_id TEXT, agent_id TEXT,
  ts TEXT, name TEXT, model TEXT, is_error INTEGER);
CREATE INDEX tool_calls_session ON tool_calls(session_id);
CREATE TABLE subagents(agent_id TEXT PRIMARY KEY, session_id TEXT, type TEXT, tool_use_id TEXT);
CREATE TABLE compactions(uuid TEXT PRIMARY KEY, file_id INTEGER, session_id TEXT, ts TEXT);
CREATE TABLE cost_states(file_id INTEGER, line INTEGER, session_id TEXT, start_ms INTEGER, cost REAL,
  incomplete INTEGER, api_ms INTEGER, tool_ms INTEGER, lines_added INTEGER, lines_removed INTEGER,
  model_usage TEXT, PRIMARY KEY(file_id, line));
CREATE TABLE titles(file_id INTEGER, line INTEGER, session_id TEXT, kind TEXT, title TEXT, PRIMARY KEY(file_id, line));
CREATE TABLE sessions(id TEXT PRIMARY KEY, provider TEXT, slug TEXT, cwd TEXT, project TEXT, title TEXT, first_ts TEXT,
  last_ts TEXT, cost REAL, cost_incomplete INTEGER, cost_estimated INTEGER, price_check TEXT, api_ms INTEGER, tool_ms INTEGER,
  lines_added INTEGER, lines_removed INTEGER, carried_from TEXT,
  model_cost TEXT);
`;

// Tables holding rows ingested from one transcript file; used when a file starts a new generation.
export const FILE_TABLES = ["records", "requests", "repeats", "owner_messages", "tool_calls", "compactions", "cost_states", "titles"];

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const old = new DatabaseSync(path);
    const version = (() => {
      try {
        return old.prepare("SELECT value FROM meta WHERE key = 'schema'").get()?.value;
      } catch {
        return undefined;
      }
    })();
    if (version === String(SCHEMA_VERSION)) return old;
    old.close();
    for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  db.prepare("INSERT INTO meta(key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION));
  return db;
}

// For commands that only read: the database must exist at the current schema.
export function readDb(path) {
  if (!existsSync(path)) throw new Error("no database yet: run `node bin/insights.mjs scan` first");
  const db = new DatabaseSync(path, { readOnly: true });
  const version = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get()?.value;
  if (version !== String(SCHEMA_VERSION)) {
    db.close();
    throw new Error("the database predates this version of the tool: run `node bin/insights.mjs scan` to rebuild it");
  }
  return db;
}

export function transaction(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
