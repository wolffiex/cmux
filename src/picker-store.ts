/**
 * Tracks picker selection frequency per layout transition.
 * Records which items users select from each source layout,
 * so when they're on that layout again, the most common
 * destinations are shown first.
 */

import { getDb } from "./db";

export type PickerItemType = "screen" | "repo" | "host" | "dir" | "cmd";

export interface PickerFrequency {
  from_layout: string;
  host: string;
  type: PickerItemType;
  key: string;
  count: number;
  last_used_at: number;
}

// ── Table Init ──────────────────────────────────────────────────────────────

let tableReady = false;

function ensureTable(): void {
  if (tableReady) return;
  const db = getDb();
  // Migrate: drop old table without from_layout column
  const cols = db
    .query("PRAGMA table_info(picker_frequency)")
    .all() as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === "from_layout")) {
    db.run("DROP TABLE picker_frequency");
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS picker_frequency (
      from_layout TEXT NOT NULL,
      host TEXT NOT NULL DEFAULT 'local',
      type TEXT NOT NULL,
      key TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      last_used_at INTEGER NOT NULL,
      PRIMARY KEY (from_layout, host, type, key)
    )
  `);
  tableReady = true;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Record a picker selection. Increments count for the from_layout → item
 * transition.
 */
export function recordSelection(
  fromLayout: string,
  type: PickerItemType,
  key: string,
  host: string = "local",
): void {
  ensureTable();
  getDb().run(
    `INSERT INTO picker_frequency (from_layout, host, type, key, count, last_used_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(from_layout, host, type, key)
     DO UPDATE SET count = count + 1, last_used_at = ?`,
    [fromLayout, host, type, key, Date.now(), Date.now()],
  );
}

/**
 * Get all items of a given type for a given source layout,
 * ordered by frequency then recency.
 */
export function getFrequencies(
  fromLayout: string,
  type: PickerItemType,
  host: string = "local",
): PickerFrequency[] {
  ensureTable();
  return getDb()
    .query(
      `SELECT from_layout, host, type, key, count, last_used_at
       FROM picker_frequency
       WHERE from_layout = ? AND type = ? AND host = ?
       ORDER BY count DESC, last_used_at DESC`,
    )
    .all(fromLayout, type, host) as PickerFrequency[];
}

/**
 * Get all items across all types for a given source layout,
 * ordered by frequency then recency.
 */
export function getAllFrequencies(
  fromLayout: string,
  host: string = "local",
): PickerFrequency[] {
  ensureTable();
  return getDb()
    .query(
      `SELECT from_layout, host, type, key, count, last_used_at
       FROM picker_frequency
       WHERE from_layout = ? AND host = ?
       ORDER BY count DESC, last_used_at DESC`,
    )
    .all(fromLayout, host) as PickerFrequency[];
}

/** Test helper: clear all frequency data. */
export function _clearAll(): void {
  ensureTable();
  getDb().run("DELETE FROM picker_frequency");
}
