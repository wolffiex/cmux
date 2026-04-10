/**
 * Tracks layout transition history to rank layout choices.
 * Records which layout users switch to from each source layout,
 * so the next time they're on that layout, the most common
 * destination is shown first.
 */

import { getDb } from "./db";

// ── Table Init ──────────────────────────────────────────────────────────────

let tableReady = false;

function ensureTable(): void {
  if (tableReady) return;
  getDb().run(`
    CREATE TABLE IF NOT EXISTS transitions (
      from_layout TEXT NOT NULL,
      to_layout TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (from_layout, to_layout)
    )
  `);
  tableReady = true;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Record a layout transition. Increments the count for from -> to.
 */
export function recordTransition(fromLayout: string, toLayout: string): void {
  if (fromLayout === toLayout) return;
  ensureTable();
  getDb().run(
    `INSERT INTO transitions (from_layout, to_layout, count)
     VALUES (?, ?, 1)
     ON CONFLICT(from_layout, to_layout)
     DO UPDATE SET count = count + 1`,
    [fromLayout, toLayout],
  );
}

/**
 * Get the top destination layouts when the user is currently on `layout`,
 * ranked by how often they've switched `layout → X` in the past. Purely
 * directional: `B → A` transitions do NOT influence the ranking when
 * ranking from `A`. Self-loop rows (from = to) are excluded defensively —
 * `recordTransition` already refuses to write them. Ties are broken by
 * `name` ascending for determinism.
 */
export function getRankedTransitions(
  layout: string,
): { name: string; count: number }[] {
  ensureTable();
  return getDb()
    .query(
      `SELECT to_layout AS name, count
       FROM transitions
       WHERE from_layout = ? AND to_layout != ?
       ORDER BY count DESC, name ASC`,
    )
    .all(layout, layout) as {
    name: string;
    count: number;
  }[];
}
