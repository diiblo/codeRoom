import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applyMigrations, migrations, type Migration } from "./migrator.js";
import { SqliteDatabase, type DatabaseSync } from "./sqlite.js";

export function assertDatabaseIntegrity(database: DatabaseSync) {
  const integrityResult = database.prepare("PRAGMA integrity_check").get() as
    { integrity_check?: string } | undefined;
  if (integrityResult?.integrity_check !== "ok") {
    throw new Error("SQLite integrity check failed");
  }

  const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length > 0) {
    throw new Error("SQLite foreign key integrity check failed");
  }
}

export function openDatabase(
  filename: string,
  pendingMigrations: readonly Migration[] = migrations,
): DatabaseSync {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });

  let database: DatabaseSync | undefined;
  try {
    database = new SqliteDatabase(filename);
    database.exec("PRAGMA foreign_keys = ON");
    if (filename !== ":memory:") {
      database.exec("PRAGMA journal_mode = WAL");
    }
    applyMigrations(database, pendingMigrations);
    assertDatabaseIntegrity(database);
    return database;
  } catch (error) {
    database?.close();
    throw error;
  }
}
