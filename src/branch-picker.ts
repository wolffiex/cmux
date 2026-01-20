/**
 * Branch picker - shows worktrees and branches for a repo.
 * Allows selecting existing worktrees/branches or creating new ones.
 */

import { execSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import {
  handleTypeaheadKey,
  initTypeahead,
  type TypeaheadItem,
  type TypeaheadState,
} from "./typeahead";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Worktree {
  path: string;
  branch: string;
  isMain: boolean;
}

export interface BranchPickerState {
  typeahead: TypeaheadState;
  repoPath: string;
  worktrees: Worktree[];
  confirmingDelete: boolean;
}

export type BranchPickerResult =
  | { action: "continue"; state: BranchPickerState }
  | { action: "cancel" }
  | { action: "select"; path: string } // Open window at this worktree path
  | { action: "create"; branch: string; path: string } // Create worktree and open
  | { action: "delete"; type: "worktree"; path: string } // Remove worktree
  | { action: "delete"; type: "branch"; branch: string }; // Delete branch

// ── Git Helpers ──────────────────────────────────────────────────────────────

/**
 * Get list of worktrees for a repo.
 */
function getWorktrees(repoPath: string): Worktree[] {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5000,
    });

    const worktrees: Worktree[] = [];
    let current: Partial<Worktree> = {};

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        current.path = line.slice(9);
      } else if (line.startsWith("branch refs/heads/")) {
        current.branch = line.slice(18);
      } else if (line === "bare") {
        // Skip bare repos
        current = {};
      } else if (line === "") {
        if (current.path && current.branch) {
          worktrees.push({
            path: current.path,
            branch: current.branch,
            isMain: worktrees.length === 0, // First worktree is main
          });
        }
        current = {};
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Get list of branches not associated with a worktree.
 */
function getBranchesWithoutWorktree(
  repoPath: string,
  worktrees: Worktree[],
): string[] {
  try {
    const output = execSync("git branch --format='%(refname:short)'", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5000,
    });

    const worktreeBranches = new Set(worktrees.map((w) => w.branch));
    return output
      .split("\n")
      .map((b) => b.trim())
      .filter((b) => b && !worktreeBranches.has(b));
  } catch {
    return [];
  }
}

/**
 * Get the main worktree path (for determining sibling location).
 */
function getMainWorktreePath(repoPath: string): string {
  try {
    // Get the root of the git repo
    const root = execSync("git rev-parse --show-toplevel", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    // Check if this is a worktree or the main repo
    const gitDir = execSync("git rev-parse --git-dir", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    // If git-dir contains "worktrees", this is a worktree - find main repo
    if (gitDir.includes("/worktrees/")) {
      // gitDir is like /path/to/main/.git/worktrees/branch-name
      const mainGitDir = gitDir.split("/worktrees/")[0];
      return dirname(mainGitDir);
    }

    return root;
  } catch {
    return repoPath;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format path with ~ substitution.
 */
function formatPath(path: string): string {
  const home = process.env.HOME || "/home";
  if (path.startsWith(`${home}/`)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

/**
 * Get dynamic title based on selected item and confirmation state.
 */
function getTitleForSelection(
  typeahead: TypeaheadState,
  confirmingDelete: boolean,
): string {
  if (confirmingDelete) return "Delete? [⏎/esc]";
  const selected = typeahead.filtered[typeahead.selectedIndex];
  if (!selected) return "branch";
  if (selected.id.startsWith("worktree:")) return "worktree";
  if (selected.id.startsWith("branch:")) return "branch";
  return "branch";
}

/**
 * Update typeahead with dynamic title.
 */
function withDynamicTitle(
  typeahead: TypeaheadState,
  confirmingDelete: boolean,
): TypeaheadState {
  return {
    ...typeahead,
    title: getTitleForSelection(typeahead, confirmingDelete),
  };
}

// ── State Management ─────────────────────────────────────────────────────────

/**
 * Initialize branch picker for a repo.
 */
export function initBranchPicker(repoPath: string): BranchPickerState {
  const worktrees = getWorktrees(repoPath);
  const branches = getBranchesWithoutWorktree(repoPath, worktrees);

  const items: TypeaheadItem[] = [];

  // Add worktrees first (they're ready to use)
  for (const wt of worktrees) {
    items.push({
      id: `worktree:${wt.path}`,
      label: wt.branch,
      hint: formatPath(wt.path),
      icon: "📂",
      marker: wt.isMain ? "●" : undefined,
    });
  }

  // Add branches without worktrees
  for (const branch of branches) {
    items.push({
      id: `branch:${branch}`,
      label: branch,
      icon: "🌿",
    });
  }

  const typeahead = initTypeahead(items);
  return {
    typeahead: withDynamicTitle(typeahead, false),
    repoPath,
    worktrees,
    confirmingDelete: false,
  };
}

/**
 * Get the currently selected item.
 */
function getSelectedItem(state: BranchPickerState): TypeaheadItem | undefined {
  return state.typeahead.filtered[state.typeahead.selectedIndex];
}

/**
 * Check if the selected item can be deleted (not main worktree).
 */
function canDeleteSelected(state: BranchPickerState): boolean {
  const selected = getSelectedItem(state);
  if (!selected) return false;

  // Can't delete main worktree
  if (selected.id.startsWith("worktree:")) {
    const path = selected.id.slice(9);
    const worktree = state.worktrees.find((w) => w.path === path);
    if (worktree?.isMain) return false;
  }

  return true;
}

/**
 * Handle key press.
 */
export function handleBranchPickerKey(
  state: BranchPickerState,
  key: string,
): BranchPickerResult {
  // Handle delete confirmation
  if (state.confirmingDelete) {
    if (key === "\r" || key === " ") {
      // Confirm delete
      const selected = getSelectedItem(state);
      if (selected) {
        if (selected.id.startsWith("worktree:")) {
          const path = selected.id.slice(9);
          return { action: "delete", type: "worktree", path };
        }
        if (selected.id.startsWith("branch:")) {
          const branch = selected.id.slice(7);
          return { action: "delete", type: "branch", branch };
        }
      }
      const newTypeahead = withDynamicTitle(state.typeahead, false);
      return {
        action: "continue",
        state: { ...state, typeahead: newTypeahead, confirmingDelete: false },
      };
    }
    if (key === "\x1b" || key === "q") {
      // Cancel delete
      const newTypeahead = withDynamicTitle(state.typeahead, false);
      return {
        action: "continue",
        state: { ...state, typeahead: newTypeahead, confirmingDelete: false },
      };
    }
    // Ignore other keys during confirmation
    return { action: "continue", state };
  }

  // Handle delete key (Ctrl+X or Delete key)
  if (key === "\x18" || key === "\x1b[3~") {
    if (canDeleteSelected(state)) {
      const newTypeahead = withDynamicTitle(state.typeahead, true);
      return {
        action: "continue",
        state: { ...state, typeahead: newTypeahead, confirmingDelete: true },
      };
    }
    return { action: "continue", state };
  }

  const result = handleTypeaheadKey(state.typeahead, key);

  switch (result.action) {
    case "continue": {
      const newTypeahead = withDynamicTitle(result.state, false);
      return {
        action: "continue",
        state: { ...state, typeahead: newTypeahead, confirmingDelete: false },
      };
    }

    case "cancel":
      return { action: "cancel" };

    case "select": {
      const itemId = result.item.id;

      if (itemId.startsWith("worktree:")) {
        const path = itemId.slice(9);
        return { action: "select", path };
      }

      if (itemId.startsWith("branch:")) {
        const branch = itemId.slice(7);
        // Create worktree for this branch
        const mainPath = getMainWorktreePath(state.repoPath);
        const parentDir = dirname(mainPath);
        const repoName = basename(mainPath);
        const worktreePath = join(parentDir, `${repoName}-${branch}`);
        return { action: "create", branch, path: worktreePath };
      }

      return { action: "cancel" };
    }

    case "create": {
      // User typed a new branch name - create worktree
      const branch = result.input.trim();
      if (!branch) return { action: "cancel" };

      const mainPath = getMainWorktreePath(state.repoPath);
      const parentDir = dirname(mainPath);
      const repoName = basename(mainPath);
      const worktreePath = join(parentDir, `${repoName}-${branch}`);

      return { action: "create", branch, path: worktreePath };
    }
  }
}
