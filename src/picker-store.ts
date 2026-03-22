/**
 * Tracks picker selection frequency for ordering.
 * Every time the user selects something from the top-level picker,
 * we bump its count. The picker orders by count DESC, last_used_at DESC.
 */

import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type PickerItemType = "screen" | "repo" | "host" | "directory";

export interface PickerFrequency {
  host: string;
  type: PickerItemType;
  key: string;
  count: number;
  last_used_at: number;
}

// ── Database Setup ──────────────────────────────────────────────────────────

function getDbPath(): string {
  const cacheDir = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  const cmuxDir = join(cacheDir, "cmux");
  if (!existsSync(cmuxDir)) {
    mkdirSync(cmuxDir, { recursive: true });
  }
  return join(cmuxDir, "picker.sqlite");
}

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    const dbPath = getDbPath();
    db = new Database(dbPath, { create: true });
    chmodSync(dbPath, 0o600);

    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA wal_checkpoint(TRUNCATE)");

    db.run(`
      CREATE TABLE IF NOT EXISTS picker_frequency (
        host TEXT NOT NULL DEFAULT 'local',
        type TEXT NOT NULL,
        key TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        last_used_at INTEGER NOT NULL,
        PRIMARY KEY (host, type, key)
      )
    `);
  }
  return db;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Record a picker selection. Increments count and updates last_used_at.
 */
export function recordSelection(
  type: PickerItemType,
  key: string,
  host: string = "local",
): void {
  getDb().run(
    `INSERT INTO picker_frequency (host, type, key, count, last_used_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(host, type, key)
     DO UPDATE SET count = count + 1, last_used_at = ?`,
    [host, type, key, Date.now(), Date.now()],
  );
}

/**
 * Get all items of a given type, ordered by frequency then recency.
 */
export function getFrequencies(
  type: PickerItemType,
  host: string = "local",
): PickerFrequency[] {
  return getDb()
    .query(
      `SELECT host, type, key, count, last_used_at
       FROM picker_frequency
       WHERE type = ? AND host = ?
       ORDER BY count DESC, last_used_at DESC`,
    )
    .all(type, host) as PickerFrequency[];
}

/**
 * Get all items across all types, ordered by frequency then recency.
 * Useful for the top-level mixed picker.
 */
export function getAllFrequencies(
  host: string = "local",
): PickerFrequency[] {
  return getDb()
    .query(
      `SELECT host, type, key, count, last_used_at
       FROM picker_frequency
       WHERE host = ?
       ORDER BY count DESC, last_used_at DESC`,
    )
    .all(host) as PickerFrequency[];
}

/** Test helper: clear all frequency data. */
export function _clearAll(): void {
  getDb().run("DELETE FROM picker_frequency");
}

export function closePickerStore(): void {
  if (db) {
    try {
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // Ignore checkpoint errors during shutdown
    }
    try {
      db.close();
    } catch {
      // Ignore close errors during shutdown
    }
    db = null;
  }
}
