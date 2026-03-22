/**
 * Shared SQLite database module.
 * All store modules share a single cmux.sqlite database.
 * Single-writer assumption: no WAL needed.
 */

import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let db: Database | null = null;

/**
 * Get the shared database connection (singleton).
 * Creates the database file and directory on first call.
 */
export function getDb(): Database {
  if (!db) {
    const cacheDir = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
    const cmuxDir = join(cacheDir, "cmux");
    if (!existsSync(cmuxDir)) {
      mkdirSync(cmuxDir, { recursive: true });
    }
    const dbPath = join(cmuxDir, "cmux.sqlite");

    db = new Database(dbPath, { create: true });
    chmodSync(dbPath, 0o600);
  }
  return db;
}

/**
 * Close the shared database connection.
 */
export function closeDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      // Ignore close errors during shutdown
    }
    db = null;
  }
}
