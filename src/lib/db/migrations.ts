import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  /** Sequential version, stored in SQLite's `PRAGMA user_version`. */
  version: number;
  name: string;
  sql: string;
}

/**
 * Append-only list of migrations. Never edit a migration that has shipped;
 * add a new one instead.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial schema",
    sql: `
      CREATE TABLE chats (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE messages (
        id TEXT PRIMARY KEY NOT NULL,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        model_id TEXT,
        route TEXT CHECK (route IS NULL OR route IN ('direct', 'opencode')),
        format TEXT CHECK (format IS NULL OR format IN ('markdown', 'openui')),
        sources_json TEXT
      ) STRICT;

      CREATE TABLE episodes (
        id TEXT PRIMARY KEY NOT NULL,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        assistant_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_text TEXT NOT NULL,
        answer_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_from TEXT,
        resolved_to TEXT,
        timezone TEXT
      ) STRICT;

      CREATE TABLE claims (
        id TEXT PRIMARY KEY NOT NULL,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        source_url TEXT NOT NULL CHECK (length(trim(source_url)) > 0),
        source_title TEXT,
        source_published_at TEXT,
        asserted_at TEXT NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        supersedes_claim_id TEXT REFERENCES claims(id) ON DELETE SET NULL,
        is_latest INTEGER NOT NULL DEFAULT 1 CHECK (is_latest IN (0, 1))
      ) STRICT;

      CREATE INDEX idx_messages_chat_created
        ON messages(chat_id, created_at);

      CREATE INDEX idx_episodes_chat_created
        ON episodes(chat_id, created_at);
      CREATE INDEX idx_episodes_created
        ON episodes(created_at);

      CREATE INDEX idx_claims_chat_asserted
        ON claims(chat_id, asserted_at);
      CREATE INDEX idx_claims_episode
        ON claims(episode_id);
      CREATE INDEX idx_claims_asserted
        ON claims(asserted_at);
      CREATE INDEX idx_claims_supersedes
        ON claims(supersedes_claim_id);
      CREATE INDEX idx_claims_latest
        ON claims(is_latest);
    `,
  },
];

export function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get();
  const value = row?.user_version;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return 0;
}

function applyMigration(db: DatabaseSync, migration: Migration): void {
  if (!Number.isInteger(migration.version) || migration.version < 1) {
    throw new Error(`Invalid migration version: ${migration.version}`);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    // Re-check inside the write lock: another process may have applied this
    // migration while this one waited to begin.
    if (getSchemaVersion(db) >= migration.version) {
      db.exec("COMMIT");
      return;
    }

    db.exec(migration.sql);
    db.exec(`PRAGMA user_version = ${migration.version}`);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The original error is more useful; ignore rollback failures.
    }
    throw error;
  }
}

/**
 * Applies every migration newer than the database's `user_version`, each in
 * its own transaction. Returns the schema version after migrating.
 */
export function migrate(db: DatabaseSync): number {
  const current = getSchemaVersion(db);
  const latest = MIGRATIONS.at(-1)?.version ?? 0;

  if (current > latest) {
    throw new Error(
      `Database schema version ${current} is newer than this build supports (${latest}).`,
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version > current) applyMigration(db, migration);
  }

  return latest;
}
