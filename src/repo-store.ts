/**
 * Store for tracking known git repositories.
 * Repos are collected automatically as windows are opened.
 */

import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getLastActivity, resolveRepoPath } from "./git-utils";

// Re-export git utilities for external consumers
export { isGitRepo, resolveRepoPath } from "./git-utils";

export interface RepoInfo {
  name: string; // short name (e.g., "cmux")
  path: string; // canonical repo path (main checkout, not worktrees)
  lastSeen: number; // timestamp when we last saw this repo
}

// ── Database Setup ──────────────────────────────────────────────────────────

function getDbPath(): string {
  const cacheDir = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  const cmuxDir = join(cacheDir, "cmux");
  if (!existsSync(cmuxDir)) {
    mkdirSync(cmuxDir, { recursive: true });
  }
  return join(cmuxDir, "repos.sqlite");
}

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    const dbPath = getDbPath();
    db = new Database(dbPath, { create: true });
    chmodSync(dbPath, 0o600);

    db.run("PRAGMA journal_mode = WAL");

    // Checkpoint any existing WAL bloat from previous runs that exited
    // without closing the DB. TRUNCATE resets the WAL file to zero size.
    db.run("PRAGMA wal_checkpoint(TRUNCATE)");

    // Check schema - blow away if it doesn't match expected base columns
    const tableInfo = db.query("PRAGMA table_info(repos)").all() as {
      name: string;
    }[];
    const columns = new Set(tableInfo.map((col) => col.name));
    const requiredColumns = ["path", "name", "last_seen"];
    const hasRequiredColumns = requiredColumns.every((col) =>
      columns.has(col),
    );

    if (!hasRequiredColumns) {
      db.run("DROP TABLE IF EXISTS repos");
      db.run(`
        CREATE TABLE repos (
          path TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          last_seen INTEGER NOT NULL,
          last_activity INTEGER,
          last_activity_checked INTEGER
        )
      `);
    } else {
      // Migrate: add last_activity columns if missing
      if (!columns.has("last_activity")) {
        db.run("ALTER TABLE repos ADD COLUMN last_activity INTEGER");
      }
      if (!columns.has("last_activity_checked")) {
        db.run(
          "ALTER TABLE repos ADD COLUMN last_activity_checked INTEGER",
        );
      }
    }
  }
  return db;
}

// ── Store Operations ────────────────────────────────────────────────────────

const TRACK_WRITE_INTERVAL = 60 * 60 * 1000; // 1 hour - skip writes if last_seen is recent

/**
 * Track a repo (insert or update).
 * Resolves worktrees to their main repo path.
 * Skips the write if last_seen was updated within the last hour to reduce WAL writes.
 */
export function trackRepo(path: string): RepoInfo | null {
  const repoPath = resolveRepoPath(path);
  if (!repoPath) return null;

  const name = repoPath.split("/").pop() || "repo";
  const now = Date.now();

  const database = getDb();

  // Check if we already have a recent entry - skip write if so
  const existing = database
    .query("SELECT last_seen FROM repos WHERE path = ?")
    .get(repoPath) as { last_seen: number } | null;

  if (existing && now - existing.last_seen < TRACK_WRITE_INTERVAL) {
    return { name, path: repoPath, lastSeen: existing.last_seen };
  }

  const info: RepoInfo = {
    name,
    path: repoPath,
    lastSeen: now,
  };

  database.run(
    `INSERT INTO repos (path, name, last_seen) VALUES (?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`,
    [info.path, info.name, info.lastSeen],
  );

  return info;
}

const ACTIVITY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached activity timestamp for a repo, refreshing if stale.
 * Persists the activity cache in SQLite so it survives across cmux invocations.
 */
function getCachedActivity(path: string): number {
  const database = getDb();
  const now = Date.now();

  // Check DB for persisted activity cache
  const row = database
    .query(
      "SELECT last_activity, last_activity_checked FROM repos WHERE path = ?",
    )
    .get(path) as {
    last_activity: number | null;
    last_activity_checked: number | null;
  } | null;

  if (
    row &&
    row.last_activity !== null &&
    row.last_activity_checked !== null &&
    now - row.last_activity_checked < ACTIVITY_CACHE_TTL
  ) {
    return row.last_activity;
  }

  // Cache miss or stale - call git and persist
  const timestamp = getLastActivity(path);
  database.run(
    "UPDATE repos SET last_activity = ?, last_activity_checked = ? WHERE path = ?",
    [timestamp, now, path],
  );
  return timestamp;
}

/**
 * Get all known repos, sorted by most recent git activity.
 * Filters out repos whose paths no longer exist.
 */
export function getKnownRepos(): RepoInfo[] {
  const database = getDb();
  const rows = database
    .query("SELECT path, name, last_seen FROM repos")
    .all() as {
    path: string;
    name: string;
    last_seen: number;
  }[];

  const repos: RepoInfo[] = [];
  const toDelete: string[] = [];

  for (const row of rows) {
    if (existsSync(row.path)) {
      repos.push({
        path: row.path,
        name: row.name,
        lastSeen: row.last_seen,
      });
    } else {
      toDelete.push(row.path);
    }
  }

  // Clean up stale entries
  for (const path of toDelete) {
    database.run("DELETE FROM repos WHERE path = ?", [path]);
  }

  // Sort by activity (most recent first)
  return repos.sort((a, b) => {
    const activityA = getCachedActivity(a.path);
    const activityB = getCachedActivity(b.path);
    return activityB - activityA;
  });
}

/**
 * Collect repos from all current tmux window paths.
 */
export function collectReposFromWindows(): void {
  try {
    const output = execFileSync(
      "tmux",
      ["list-windows", "-F", "#{pane_current_path}"],
      {
        encoding: "utf-8",
        timeout: 5000,
      },
    ).trim();

    for (const path of output.split("\n")) {
      if (path) {
        trackRepo(path);
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Close the repo store database connection.
 * Runs WAL checkpoint to compact the WAL file before closing.
 */
export function closeRepoStore(): void {
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
