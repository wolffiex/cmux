/**
 * Utilities for managing git worktrees.
 */

import { execFileSync } from "node:child_process";
import { basename } from "node:path";

/**
 * Check if a branch exists in the repo.
 */
function branchExists(repoPath: string, branchName: string): boolean {
  try {
    execFileSync(
      "git",
      ["-C", repoPath, "rev-parse", "--verify", `refs/heads/${branchName}`],
      { stdio: ["pipe", "pipe", "ignore"], timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a worktree and optionally its associated branch.
 * If the worktree directory name matches a branch name, deletes both.
 */
export function deleteWorktree(repoPath: string, worktreePath: string): void {
  const worktreeName = basename(worktreePath);

  // Check if branch with same name exists before removing worktree
  const hasBranch = branchExists(repoPath, worktreeName);

  // Remove the worktree
  try {
    execFileSync("git", ["-C", repoPath, "worktree", "remove", worktreePath], {
      timeout: 10000,
    });
  } catch {
    // Force remove if normal remove fails
    execFileSync(
      "git",
      ["-C", repoPath, "worktree", "remove", "--force", worktreePath],
      { timeout: 10000 },
    );
  }

  // Delete branch if it matches the worktree directory name
  if (hasBranch) {
    try {
      execFileSync("git", ["-C", repoPath, "branch", "-d", worktreeName], {
        timeout: 10000,
      });
    } catch {
      // Force delete if normal delete fails (e.g., unmerged branch)
      execFileSync("git", ["-C", repoPath, "branch", "-D", worktreeName], {
        timeout: 10000,
      });
    }
  }
}
