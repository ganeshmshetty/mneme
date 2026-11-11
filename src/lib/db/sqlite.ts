import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { migrate } from "@/lib/db/migrations";

export const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "mneme.sqlite");

/**
 * The database location in priority order: `MNEME_DB_PATH`, then
 * `data/mneme.sqlite`. Relative override paths are resolved from the working
 * directory.
 */
export function resolveDatabasePath(): string {
  const override = process.env.MNEME_DB_PATH?.trim();
  if (!override) return DEFAULT_DB_PATH;
  if (override === ":memory:" || override.startsWith("file:")) return override;
  return path.resolve(override);
}

/**
 * Opens the SQLite file, turns on WAL and foreign keys, and brings the schema
 * up to date. Callers own the returned handle and should close it, unless they
 * use `getDatabase()`.
 */
export function openDatabase(file: string = resolveDatabasePath()): DatabaseSync {
  if (file !== ":memory:" && !file.startsWith("file:")) {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }

  const db = new DatabaseSync(file, {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });

  try {
    // WAL is a no-op for an in-memory database, but it is what we want for the
    // real file. Foreign keys are repeated here so every connection agrees.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA synchronous = NORMAL");

    migrate(db);
    return db;
  } catch (error) {
    if (db.isOpen) db.close();
    throw error;
  }
}

type GlobalWithDatabase = typeof globalThis & {
  __mnemeDatabase?: DatabaseSync;
};

const globalForDatabase = globalThis as GlobalWithDatabase;

/**
 * Process-wide lazy connection. Next.js reloads modules in development, so the
 * handle lives on `globalThis` to avoid opening a new connection per reload.
 */
export function getDatabase(): DatabaseSync {
  const existing = globalForDatabase.__mnemeDatabase;
  if (existing?.isOpen) return existing;

  const db = openDatabase();
  globalForDatabase.__mnemeDatabase = db;
  return db;
}

/**
 * Closes a connection and clears it from the process-wide cache when it is the
 * cached connection. Safe to call more than once.
 */
export function closeDatabase(db?: DatabaseSync): void {
  const target = db ?? globalForDatabase.__mnemeDatabase;
  if (!target) return;

  if (globalForDatabase.__mnemeDatabase === target) {
    globalForDatabase.__mnemeDatabase = undefined;
  }

  if (target.isOpen) target.close();
}
