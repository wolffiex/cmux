/**
 * Tracks picker selection frequency for ordering.
 * Every time the user selects something from the top-level picker,
 * we bump its count. The picker orders by count DESC, last_used_at DESC.
 */

import { getDb } from "./db";

export type PickerItemType = "screen" | "repo" | "host" | "dir" | "cmd";

export interface PickerFrequency {
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
  getDb().run(`
    CREATE TABLE IF NOT EXISTS picker_frequency (
      host TEXT NOT NULL DEFAULT 'local',
      type TEXT NOT NULL,
      key TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      last_used_at INTEGER NOT NULL,
      PRIMARY KEY (host, type, key)
    )
  `);
  tableReady = true;
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
  ensureTable();
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
  ensureTable();
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
  ensureTable();
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
  ensureTable();
  getDb().run("DELETE FROM picker_frequency");
}
