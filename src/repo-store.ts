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

    // Check schema - blow away if it doesn't match
    const tableInfo = db.query("PRAGMA table_info(repos)").all() as {
      name: string;
    }[];
    const columns = new Set(tableInfo.map((col) => col.name));
    const expectedColumns = new Set(["path", "name", "last_seen"]);
    const schemaMatches =
      columns.size === expectedColumns.size &&
      [...expectedColumns].every((col) => columns.has(col));

    if (!schemaMatches) {
      db.run("DROP TABLE IF EXISTS repos");
      db.run(`
        CREATE TABLE repos (
          path TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          last_seen INTEGER NOT NULL
        )
      `);
    }
  }
  return db;
}

// ── Store Operations ────────────────────────────────────────────────────────

/**
 * Track a repo (insert or update).
 * Resolves worktrees to their main repo path.
 */
export function trackRepo(path: string): RepoInfo | null {
  const repoPath = resolveRepoPath(path);
  if (!repoPath) return null;

  const name = repoPath.split("/").pop() || "repo";

  const info: RepoInfo = {
    name,
    path: repoPath,
    lastSeen: Date.now(),
  };

  const database = getDb();
  database.run(
    `INSERT OR REPLACE INTO repos (path, name, last_seen) VALUES (?, ?, ?)`,
    [info.path, info.name, info.lastSeen],
  );

  return info;
}

// In-memory cache for activity timestamps (refreshed on demand)
const activityCache = new Map<
  string,
  { timestamp: number; cachedAt: number }
>();
const ACTIVITY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached activity timestamp for a repo, refreshing if stale.
 */
function getCachedActivity(path: string): number {
  const cached = activityCache.get(path);
  const now = Date.now();

  if (cached && now - cached.cachedAt < ACTIVITY_CACHE_TTL) {
    return cached.timestamp;
  }

  const timestamp = getLastActivity(path);
  activityCache.set(path, { timestamp, cachedAt: now });
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
