/**
 * Tracks layout transition history to rank layout choices.
 * Records which layout users switch to from each source layout,
 * so the next time they're on that layout, the most common
 * destination is shown first.
 */

import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Database Setup ──────────────────────────────────────────────────────────

function getDbPath(): string {
  const cacheDir = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  const cmuxDir = join(cacheDir, "cmux");
  if (!existsSync(cmuxDir)) {
    mkdirSync(cmuxDir, { recursive: true });
  }
  return join(cmuxDir, "layout-transitions.sqlite");
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
      CREATE TABLE IF NOT EXISTS transitions (
        from_layout TEXT NOT NULL,
        to_layout TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (from_layout, to_layout)
      )
    `);
  }
  return db;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Record a layout transition. Increments the count for from -> to.
 */
export function recordTransition(
  fromLayout: string,
  toLayout: string,
): void {
  if (fromLayout === toLayout) return;
  getDb().run(
    `INSERT INTO transitions (from_layout, to_layout, count)
     VALUES (?, ?, 1)
     ON CONFLICT(from_layout, to_layout)
     DO UPDATE SET count = count + 1`,
    [fromLayout, toLayout],
  );
}

/**
 * Get layout names ranked by how often the user transitions to them
 * from the given source layout. Returns layout names in descending
 * order of count.
 */
export function getRankedTransitions(
  fromLayout: string,
): { name: string; count: number }[] {
  return getDb()
    .query(
      `SELECT to_layout as name, count
       FROM transitions
       WHERE from_layout = ?
       ORDER BY count DESC`,
    )
    .all(fromLayout) as { name: string; count: number }[];
}

export function closeLayoutStore(): void {
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
