export {
  DEFAULT_DB_PATH,
  closeDatabase,
  getDatabase,
  getDatabase as getDb,
  openDatabase,
  resolveDatabasePath,
} from "@/lib/db/sqlite";

export {
  MIGRATIONS,
  getSchemaVersion,
  migrate,
  type Migration,
} from "@/lib/db/migrations";
