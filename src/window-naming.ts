/**
 * Window naming algorithm for cmux.
 * Generates window names based on git repo/branch.
 * Display truncation is handled by the UI layer.
 */

import { execSync } from "node:child_process";
import { basename } from "node:path";
import { log } from "./logger";
import { getWindows } from "./tmux";

/**
 * Get the path to the config file.
 * Uses XDG_CONFIG_HOME or falls back to ~/.config
 */
export function getConfigPath(): string {
  const xdgConfig =
    process.env.XDG_CONFIG_HOME || `${process.env.HOME}/.config`;
  return `${xdgConfig}/cmux/repos`;
}

/**
 * Load repo name aliases from config file.
 * Format: key=value lines (e.g., claude-cli-internal=cli)
 * Comments (lines starting with #) and blank lines are ignored.
 */
export function loadRepoConfig(): Map<string, string> {
  const config = new Map<string, string>();

  try {
    const configPath = getConfigPath();
    const content = require("node:fs").readFileSync(configPath, "utf-8");

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        if (key && value) {
          config.set(key, value);
        }
      }
    }
  } catch {
    // Config file doesn't exist or can't be read - that's fine
  }

  return config;
}

/**
 * Get repo name and branch from a directory path.
 * Uses git commands to detect git context.
 * Returns null if not a git repo.
 *
 * Special case: If the branch name matches the worktree directory name,
 * we return the actual repository name instead. This is useful for worktrees
 * where the directory is named after the branch (e.g., "feature-xyz" worktree
 * with "feature-xyz" branch should show the repo name, not the worktree name).
 */
export function getRepoFromPath(
  panePath: string,
): { repo: string; branch: string } | null {
  if (!panePath) return null;

  try {
    // Get git root directory
    const gitRoot = execSync(
      `git -C '${panePath}' rev-parse --show-toplevel 2>/dev/null`,
    )
      .toString()
      .trim();

    if (!gitRoot) return null;

    // Get repo/worktree name from the root directory
    // For regular repos: gitRoot is the repo root (e.g., /home/user/repos/myproject)
    // For worktrees: gitRoot is the worktree root (e.g., /home/user/repos/myproject-feature)
    const worktreeName = basename(gitRoot);

    // Get current branch
    let branch: string;
    try {
      branch = execSync(
        `git -C '${panePath}' rev-parse --abbrev-ref HEAD 2>/dev/null`,
      )
        .toString()
        .trim();

      // Handle detached HEAD - use short SHA
      if (branch === "HEAD") {
        branch = execSync(
          `git -C '${panePath}' rev-parse --short HEAD 2>/dev/null`,
        )
          .toString()
          .trim();
      }
    } catch {
      branch = "unknown";
    }

    // Special case: if worktree name is exactly {repo}-{branch}, use the repo name
    // e.g., worktree "cmux-layout-picker" with branch "layout-picker" and repo "cmux"
    try {
      const commonDir = execSync(
        `git -C '${panePath}' rev-parse --git-common-dir 2>/dev/null`,
      )
        .toString()
        .trim();

      // For worktrees, commonDir points to main repo's .git directory
      // e.g., /home/user/repos/myproject/.git
      // For regular repos, commonDir is just ".git"
      if (commonDir && commonDir !== ".git") {
        const repoPath = commonDir.replace(/\/\.git\/?$/, "");
        const actualRepoName = basename(repoPath);

        // Only use repo name if worktree is exactly {repo}-{branch}
        if (worktreeName === `${actualRepoName}-${branch}`) {
          return { repo: actualRepoName, branch };
        }
      }
    } catch {
      // Fall through to default behavior
    }

    return { repo: worktreeName, branch };
  } catch {
    return null;
  }
}

/**
 * Apply config alias if available, otherwise return repo name as-is.
 * Display truncation is handled by the UI layer.
 */
export function processRepoName(
  repo: string,
  config: Map<string, string>,
): string {
  // Check for config alias first
  const alias = config.get(repo);
  if (alias) return alias;

  // Return repo name as-is - UI layer handles truncation
  return repo;
}

/**
 * Process branch name.
 * Returns null for main/master, otherwise strips everything before last "/".
 */
export function processBranchName(branch: string): string | null {
  if (!branch) return null;

  // Default branches return null
  if (branch === "main" || branch === "master") {
    return null;
  }

  // Strip everything before and including the last "/"
  const lastSlash = branch.lastIndexOf("/");
  if (lastSlash >= 0) {
    return branch.slice(lastSlash + 1);
  }

  return branch;
}

/**
 * Generate a window name from git repo/branch.
 * Display truncation is handled by the UI layer.
 *
 * Algorithm:
 * 1. Get git context from path. Not a git repo? Use basename(path)
 * 2. Process repo: config alias > use as-is
 * 3. Process branch: null if main/master, else strip everything before last /
 * 4. If branch is null, return just repo
 * 5. Return repo/branch combined
 */
export function generateWindowName(
  panePath: string,
  config: Map<string, string>,
): string {
  // Get git context
  const gitInfo = getRepoFromPath(panePath);

  if (!gitInfo) {
    // Not a git repo - use basename of path
    return panePath ? basename(panePath) : "shell";
  }

  const repo = processRepoName(gitInfo.repo, config);
  const branch = processBranchName(gitInfo.branch);

  // No branch (main/master) - just return repo
  if (!branch) {
    return repo;
  }

  // Return full repo/branch - UI layer handles display truncation
  return `${repo}/${branch}`;
}

/**
 * Get the active pane path for a window.
 */
function getActivePanePath(windowIndex: number): string {
  try {
    // Get the active pane's current path
    const path = execSync(
      `tmux display-message -p -t :${windowIndex} '#{pane_current_path}'`,
    )
      .toString()
      .trim();
    return path;
  } catch {
    return "";
  }
}

/**
 * Get the pane command for fallback naming.
 */
function getPaneCommand(windowIndex: number): string {
  try {
    const cmd = execSync(
      `tmux display-message -p -t :${windowIndex} '#{pane_current_command}'`,
    )
      .toString()
      .trim();
    return cmd || "zsh";
  } catch {
    return "zsh";
  }
}

/**
 * Rename all windows in the current session using the naming algorithm.
 * Returns the number of windows renamed.
 */
export async function renameAllWindows(): Promise<number> {
  const config = loadRepoConfig();
  const windows = getWindows();
  let renamedCount = 0;

  for (const window of windows) {
    const panePath = getActivePanePath(window.index);

    let newName: string;
    if (panePath) {
      newName = generateWindowName(panePath, config);
    } else {
      // Fallback to pane command
      newName = getPaneCommand(window.index);
    }

    // Only rename if we got a valid name
    if (newName && newName.length > 0) {
      try {
        execSync(`tmux rename-window -t :${window.index} "${newName}"`);
        log(`[window-naming] Renamed window ${window.index} to "${newName}"`);
        renamedCount++;
      } catch (e) {
        log(`[window-naming] Failed to rename window ${window.index}:`, e);
      }
    }
  }

  return renamedCount;
}
