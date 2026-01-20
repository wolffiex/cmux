/**
 * Repo picker - typeahead showing repos first, then directories.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  initTypeahead,
  handleTypeaheadKey,
  renderTypeahead,
  type TypeaheadItem,
  type TypeaheadState,
} from "./typeahead";
import { getKnownRepos, getRemoteUrl, type RepoInfo } from "./repo-store";

// ── Types ───────────────────────────────────────────────────────────────────

export interface RepoPickerState {
  typeahead: TypeaheadState;
  repos: RepoInfo[];
  currentPath: string;  // for directory listing
}

export type RepoPickerResult =
  | { action: "continue"; state: RepoPickerState }
  | { action: "cancel" }
  | { action: "select"; repo: RepoInfo }
  | { action: "directory"; path: string };

// ── State Management ────────────────────────────────────────────────────────

/**
 * Convert repos to typeahead items.
 */
function reposToItems(repos: RepoInfo[]): TypeaheadItem[] {
  return repos.map((repo) => ({
    id: `repo:${repo.remoteUrl}`,
    label: repo.name,
    hint: repo.path.replace(/^\/home\/[^/]+\//, "~/"),
  }));
}

/**
 * Walk a directory tree, collecting all directories up to maxDepth.
 * Returns paths sorted by depth (shallower first), then alphabetically.
 */
function walkDirs(root: string, maxDepth: number): string[] {
  const results: { path: string; depth: number }[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

        const fullPath = join(dir, entry.name);
        results.push({ path: fullPath, depth });

        // Recurse into subdirectories
        walk(fullPath, depth + 1);
      }
    } catch {
      // Permission denied or other error - skip
    }
  }

  walk(root, 1);

  // Sort by depth first, then alphabetically
  return results
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))
    .map((r) => r.path);
}

/**
 * Get all directories for the picker.
 * Searches ~, /var, /etc in order, preferring shallower directories.
 */
function getAllDirs(): string[] {
  const home = process.env.HOME || "/home";
  const maxDepth = 4;
  const maxTotal = 500;

  const dirs: string[] = [];

  // Home directory first (most important)
  dirs.push(...walkDirs(home, maxDepth));

  // Then /var and /etc (limited depth)
  if (dirs.length < maxTotal) {
    dirs.push(...walkDirs("/var", 2));
  }
  if (dirs.length < maxTotal) {
    dirs.push(...walkDirs("/etc", 2));
  }

  return dirs.slice(0, maxTotal);
}

/**
 * Format a path with ~ substitution for home directory.
 */
function formatPath(path: string): string {
  const home = process.env.HOME || "/home";
  if (path.startsWith(home + "/")) {
    return "~" + path.slice(home.length);
  }
  if (path === home) {
    return "~";
  }
  return path;
}

/**
 * Convert directories to typeahead items.
 */
function dirsToItems(dirs: string[]): TypeaheadItem[] {
  return dirs.map((path) => ({
    id: `dir:${path}`,
    label: formatPath(path),
    marker: "📁",
  }));
}

/**
 * Get current pane path.
 */
function getCurrentPath(): string {
  try {
    return execSync("tmux display-message -p '#{pane_current_path}'", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return process.env.HOME || "/";
  }
}

/**
 * Initialize repo picker state.
 */
export function initRepoPicker(): RepoPickerState {
  const repos = getKnownRepos();
  const currentPath = getCurrentPath();

  // Combine repos + all directories
  const repoItems = reposToItems(repos);
  const dirItems = dirsToItems(getAllDirs());
  const items = [...repoItems, ...dirItems];

  return {
    typeahead: initTypeahead(items, "Choose repo or directory"),
    repos,
    currentPath,
  };
}

/**
 * Handle key press.
 */
export function handleRepoPickerKey(
  state: RepoPickerState,
  key: string,
): RepoPickerResult {
  const result = handleTypeaheadKey(state.typeahead, key);

  switch (result.action) {
    case "continue":
      return {
        action: "continue",
        state: { ...state, typeahead: result.state },
      };

    case "cancel":
      return { action: "cancel" };

    case "select": {
      const itemId = result.item.id;

      // Check if it's a repo or directory based on id prefix
      if (itemId.startsWith("repo:")) {
        const remoteUrl = itemId.slice(5); // Remove "repo:" prefix
        const repo = state.repos.find((r) => r.remoteUrl === remoteUrl);
        if (repo) {
          return { action: "select", repo };
        }
        return { action: "cancel" };
      }

      if (itemId.startsWith("dir:")) {
        const path = itemId.slice(4); // Remove "dir:" prefix
        return { action: "directory", path };
      }

      return { action: "cancel" };
    }

    case "create": {
      // User typed something that doesn't match - treat as path
      const input = result.input.trim();

      // Expand ~ to home dir
      const expanded = input.startsWith("~")
        ? input.replace(/^~/, process.env.HOME || "")
        : input;

      // Resolve to absolute path
      const path = resolve(expanded);

      // Check if it's a valid directory
      if (existsSync(path)) {
        // Check if it's a git repo
        const remoteUrl = getRemoteUrl(path);
        if (remoteUrl) {
          // It's a repo - return it directly
          const repo: RepoInfo = {
            name: path.split("/").pop() || "repo",
            path,
            remoteUrl,
            lastSeen: Date.now(),
          };
          return { action: "select", repo };
        }
      }

      // Not a known repo, not a valid git repo - pass to directory handler
      return { action: "directory", path };
    }
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

/**
 * Render repo picker.
 */
export function renderRepoPicker(
  state: RepoPickerState,
  width: number,
  height: number,
): string {
  return renderTypeahead(state.typeahead, width, height);
}
