/**
 * Store for tracking known git repositories.
 * Repos are collected automatically as windows are opened.
 */

import { Database } from "bun:sqlite";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface RepoInfo {
  name: string;        // short name (e.g., "cmux")
  path: string;        // primary path (e.g., "/home/user/code/cmux")
  remoteUrl: string;   // canonical identifier
  lastSeen: number;    // timestamp
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
    db.run(`
      CREATE TABLE IF NOT EXISTS repos (
        remote_url TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        last_seen INTEGER NOT NULL
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_last_seen ON repos(last_seen DESC)");
  }
  return db;
}

// ── Git Helpers ─────────────────────────────────────────────────────────────

/**
 * Get git remote URL for a path (returns null if not a git repo).
 */
export function getRemoteUrl(path: string): string | null {
  try {
    return execSync(`git -C '${path}' remote get-url origin 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get repo name from remote URL.
 */
export function getRepoName(remoteUrl: string): string {
  // Handle various URL formats:
  // git@github.com:user/repo.git -> repo
  // https://github.com/user/repo.git -> repo
  const cleaned = remoteUrl.replace(/\.git$/, "");
  const lastSlash = cleaned.lastIndexOf("/");
  const lastColon = cleaned.lastIndexOf(":");
  const lastSep = Math.max(lastSlash, lastColon);
  return lastSep >= 0 ? cleaned.slice(lastSep + 1) : cleaned;
}

// ── Store Operations ────────────────────────────────────────────────────────

/**
 * Track a repo (insert or update).
 */
export function trackRepo(path: string): RepoInfo | null {
  const remoteUrl = getRemoteUrl(path);
  if (!remoteUrl) return null;

  const info: RepoInfo = {
    name: getRepoName(remoteUrl),
    path,
    remoteUrl,
    lastSeen: Date.now(),
  };

  const database = getDb();
  database.run(
    `INSERT OR REPLACE INTO repos (remote_url, name, path, last_seen) VALUES (?, ?, ?, ?)`,
    [info.remoteUrl, info.name, info.path, info.lastSeen]
  );

  return info;
}

/**
 * Get all known repos, sorted by last seen (most recent first).
 * Filters out repos whose paths no longer exist.
 */
export function getKnownRepos(): RepoInfo[] {
  const database = getDb();
  const rows = database.query(
    "SELECT remote_url, name, path, last_seen FROM repos ORDER BY last_seen DESC"
  ).all() as { remote_url: string; name: string; path: string; last_seen: number }[];

  const repos: RepoInfo[] = [];
  const toDelete: string[] = [];

  for (const row of rows) {
    if (existsSync(row.path)) {
      repos.push({
        remoteUrl: row.remote_url,
        name: row.name,
        path: row.path,
        lastSeen: row.last_seen,
      });
    } else {
      toDelete.push(row.remote_url);
    }
  }

  // Clean up stale entries
  for (const url of toDelete) {
    database.run("DELETE FROM repos WHERE remote_url = ?", [url]);
  }

  return repos;
}

/**
 * Collect repos from all current tmux window paths.
 */
export function collectReposFromWindows(): void {
  try {
    const output = execSync("tmux list-windows -F '#{pane_current_path}'", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    for (const path of output.split("\n")) {
      if (path) {
        trackRepo(path);
      }
    }
  } catch {
    // Ignore errors
  }
}
