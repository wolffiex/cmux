import type { PaneContext, WindowContext } from "./tmux";
import { log } from "./logger";
import { basename } from "node:path";

// Cache layer
interface CachedSummary {
  summary: string;
  contextHash: string;
}

const cache = new Map<number, CachedSummary>();

/**
 * Common branch names that indicate no specific work context
 */
const DEFAULT_BRANCHES = ["main", "master", "develop", "dev"];

/**
 * Extract repository name from a directory path.
 * If path is within a git repo, return the repo root basename.
 * Otherwise, return the basename of the path itself.
 */
function extractRepoName(workdir: string): string {
  if (!workdir) return "shell";
  return basename(workdir) || "shell";
}

/**
 * Truncate a window name to fit within the max length.
 * Prefers keeping the repo name intact when possible.
 */
function truncate(name: string, maxLength: number): string {
  if (name.length <= maxLength) {
    return name;
  }

  // If name contains a slash (repo/branch format), try to preserve the repo
  const slashIndex = name.indexOf("/");
  if (slashIndex > 0 && slashIndex < maxLength - 2) {
    // Keep repo and truncate branch portion
    const repo = name.slice(0, slashIndex);
    const branch = name.slice(slashIndex + 1);
    const remainingSpace = maxLength - repo.length - 1; // -1 for the slash
    if (remainingSpace > 2) {
      return `${repo}/${branch.slice(0, remainingSpace)}`;
    }
  }

  // Simple truncation as fallback
  return name.slice(0, maxLength);
}

/**
 * Generate a window name based on working directory and git branch.
 * Uses a heuristic approach instead of AI for stability and speed.
 *
 * Rules:
 * - Base name is the repository/directory basename
 * - If on a feature branch, append the short branch name
 * - Default branches (main, master, etc.) just show the repo name
 *
 * Examples:
 * - cwd=/code/claude-code, branch=main -> "claude-code"
 * - cwd=/code/claude-code, branch=fix/npmrc-registry -> "claude-code/npmrc-registry"
 * - cwd=/code/api, branch=feature/PROJ-123-desc -> "api/PROJ-123-desc"
 * - cwd=/code/api, branch=user/alice/experiment -> "api/experiment"
 */
export function getWindowName(cwd: string, branch: string | null): string {
  const repo = extractRepoName(cwd);

  if (!branch || DEFAULT_BRANCHES.includes(branch)) {
    return repo;
  }

  // Remove everything up to and including the last slash in the branch name
  const shortBranch = branch.includes("/")
    ? branch.substring(branch.lastIndexOf("/") + 1)
    : branch;

  return truncate(`${repo}/${shortBranch}`, 15);
}

/**
 * Generate a simple hash from context fields for cache invalidation.
 * Only considers workdir and git branch since those determine the name.
 */
function hashContext(context: WindowContext): string {
  // Use active pane context for the hash
  const activePaneIndex = context.activePaneIndex ?? 0;
  const pane = context.panes[activePaneIndex] ?? context.panes[0];
  if (!pane) return "";
  return `${pane.workdir}|${pane.gitBranch ?? ""}`;
}

/**
 * Generate a summary for a window context using heuristics.
 * This replaces the previous AI-based approach for stability and speed.
 */
export function generateSummary(context: WindowContext): string {
  log("[cmux] generateSummary called for window:", context.windowIndex);

  // Use active pane for context (what the user is currently looking at)
  const activePaneIndex = context.activePaneIndex ?? 0;
  const pane = context.panes[activePaneIndex] ?? context.panes[0];

  if (!pane) {
    log("[cmux] No panes found, using window name");
    return context.windowName;
  }

  const name = getWindowName(pane.workdir, pane.gitBranch);
  log(`[cmux] Generated name: "${name}" from workdir="${pane.workdir}", branch="${pane.gitBranch}"`);
  return name;
}

/**
 * Get a summary for a window, using cache when available
 */
export function getSummary(context: WindowContext): string {
  const currentHash = hashContext(context);
  const cached = cache.get(context.windowIndex);

  if (cached && cached.contextHash === currentHash) {
    return cached.summary;
  }

  const summary = generateSummary(context);
  cache.set(context.windowIndex, {
    summary,
    contextHash: currentHash,
  });

  return summary;
}

/**
 * Fetch summaries for multiple windows
 */
export function getSummariesForWindows(
  contexts: WindowContext[]
): Map<number, string> {
  const results = new Map<number, string>();

  for (const context of contexts) {
    const summary = getSummary(context);
    results.set(context.windowIndex, summary);
  }

  return results;
}

// Re-export types for use by other modules
export type { PaneContext, WindowContext };
