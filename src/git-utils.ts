/**
 * Shared git utilities for cmux.
 */

import { execFileSync } from "node:child_process";

/**
 * Check if a path is a git repository.
 */
export function isGitRepo(path: string): boolean {
  try {
    execFileSync("git", ["-C", path, "rev-parse", "--git-dir"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a path to the main repo path (handles worktrees).
 * Returns the canonical absolute path to the main checkout.
 */
export function resolveRepoPath(path: string): string | null {
  try {
    // Get the common git dir (same for main repo and worktrees)
    const gitCommonDir = execFileSync(
      "git",
      ["-C", path, "rev-parse", "--git-common-dir"],
      {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "ignore"],
      },
    ).trim();

    // For main repo: returns ".git" or absolute path to .git
    // For worktree: returns "/path/to/main/repo/.git"
    if (gitCommonDir === ".git") {
      // We're in the main repo, resolve to absolute path
      return execFileSync("git", ["-C", path, "rev-parse", "--show-toplevel"], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
    }

    // Worktree: strip the .git suffix to get main repo path
    return gitCommonDir.replace(/\/\.git$/, "");
  } catch {
    return null;
  }
}

/**
 * Get the current branch name for a git repo.
 * Handles detached HEAD by returning the short SHA.
 */
export function getBranch(path: string): string | null {
  try {
    const branch = execFileSync(
      "git",
      ["-C", path, "rev-parse", "--abbrev-ref", "HEAD"],
      {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "ignore"],
      },
    ).trim();

    // Handle detached HEAD - use short SHA
    if (branch === "HEAD") {
      return execFileSync("git", ["-C", path, "rev-parse", "--short", "HEAD"], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
    }

    return branch;
  } catch {
    return null;
  }
}

/**
 * Get the timestamp of the most recent commit on any branch.
 */
export function getLastActivity(path: string): number {
  try {
    const timestamp = execFileSync(
      "git",
      ["-C", path, "log", "--all", "--format=%ct", "-1"],
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "ignore"] },
    ).trim();
    return timestamp ? parseInt(timestamp, 10) * 1000 : 0;
  } catch {
    return 0;
  }
}
