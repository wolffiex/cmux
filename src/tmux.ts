import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface PaneInfo {
  id: string;
  width: number;
  height: number;
  left: number;
  top: number;
  title: string;
}

export interface WindowInfo {
  width: number;
  height: number;
  panes: PaneInfo[];
}

export interface TmuxWindow {
  index: number;
  name: string;
  active: boolean;
  bell: boolean;
  activity: boolean;
  paneCommand: string; // Command running in first pane (to detect SSH)
}

export function getWindowInfo(): WindowInfo {
  // Single tmux command to get both window size and pane info
  const format =
    "#{window_width}:#{window_height}:#{pane_id}:#{pane_width}:#{pane_height}:#{pane_left}:#{pane_top}:#{pane_title}";
  const output = execSync(`tmux list-panes -F '${format}'`).toString().trim();

  const lines = output.split("\n");
  const [width, height] = lines[0].split(":").slice(0, 2).map(Number);

  const panes = lines.map((line) => {
    const parts = line.split(":");
    return {
      id: parts[2],
      width: Number(parts[3]),
      height: Number(parts[4]),
      left: Number(parts[5]),
      top: Number(parts[6]),
      title: parts[7] || "",
    };
  });

  return { width, height, panes };
}

/**
 * Get all windows in the current session with their status flags.
 */
export function getWindows(): TmuxWindow[] {
  const format =
    "#{window_index}:#{window_name}:#{window_active}:#{window_bell_flag}:#{window_activity_flag}:#{pane_current_command}";
  const output = execSync(`tmux list-windows -F '${format}'`).toString().trim();

  return output.split("\n").map((line) => {
    const [index, name, active, bell, activity, paneCommand] = line.split(":");
    return {
      index: Number(index),
      name,
      active: active === "1",
      bell: bell === "1",
      activity: activity === "1",
      paneCommand: paneCommand || "",
    };
  });
}

/**
 * Result of batched startup query.
 */
export interface StartupInfo {
  windows: TmuxWindow[];
  currentWindowPaneCount: number;
}

/**
 * Get all startup info in a single tmux command.
 * Combines: move-window -r, list-windows, and list-panes for current window.
 * This reduces 3 subprocess spawns to 1 for faster startup.
 */
export function getStartupInfo(): StartupInfo {
  // Use \n as section separator and | as field separator within sections
  // Section 1: list-windows output (one line per window)
  // Section 2: list-panes output for current window (just need count)
  const windowFormat =
    "#{window_index}|#{window_name}|#{window_active}|#{window_bell_flag}|#{window_activity_flag}|#{pane_current_command}";
  const paneFormat = "#{pane_id}";

  // Chain commands: renumber, then output windows, then separator, then panes
  // Using \; to chain tmux commands
  const cmd = `tmux move-window -r \\; list-windows -F '${windowFormat}' \\; display-message -p 'SECTION_SEP' \\; list-panes -F '${paneFormat}'`;

  const output = execSync(cmd).toString().trim();

  // Split by the separator
  const sections = output.split("SECTION_SEP\n");
  const windowsSection = sections[0]?.trim() || "";
  const panesSection = sections[1]?.trim() || "";

  // Parse windows
  const windows: TmuxWindow[] = windowsSection
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [index, name, active, bell, activity, paneCommand] =
        line.split("|");
      return {
        index: Number(index),
        name,
        active: active === "1",
        bell: bell === "1",
        activity: activity === "1",
        paneCommand: paneCommand || "",
      };
    });

  // Count panes (each line is one pane)
  const currentWindowPaneCount =
    panesSection.split("\n").filter((line) => line.length > 0).length || 1;

  return { windows, currentWindowPaneCount };
}

/**
 * Extract repository name from a git remote URL.
 * Handles various URL formats:
 * - git@github.com:org/repo.git -> "repo"
 * - https://github.com/org/repo.git -> "repo"
 * - https://github.com/org/repo -> "repo"
 * - /path/to/local/repo -> "repo"
 */
export function extractRepoNameFromUrl(url: string): string | null {
  // Remove .git suffix if present
  const cleanUrl = url.endsWith(".git") ? url.slice(0, -4) : url;

  // Find the last path segment
  // For SSH URLs like git@github.com:org/repo, the path starts after ':'
  // For HTTPS URLs like https://github.com/org/repo, the path starts after the domain
  // For local paths like /path/to/repo, just take the last segment

  // First handle SSH format (git@host:path)
  const colonIndex = cleanUrl.indexOf(":");
  if (colonIndex > 0 && !cleanUrl.startsWith("http")) {
    // SSH format: extract path after the colon
    const path = cleanUrl.slice(colonIndex + 1);
    const lastSlash = path.lastIndexOf("/");
    return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  }

  // For HTTPS or local paths, take the last segment after /
  const lastSlash = cleanUrl.lastIndexOf("/");
  if (lastSlash >= 0) {
    return cleanUrl.slice(lastSlash + 1);
  }

  // Fallback: return the whole thing if no separator found
  return cleanUrl || null;
}

export interface PaneContext {
  workdir: string;
  program: string;
  transcript: string;
  gitBranch: string | null;
  gitRepoName: string | null; // Actual repo name (handles worktrees correctly)
}

export interface WindowContext {
  windowIndex: number;
  windowName: string;
  panes: PaneContext[];
  activePaneIndex: number; // Index of the currently focused pane
}

/**
 * Get rich context for a specific pane.
 */
async function getPaneContext(
  windowTarget: string,
  paneIndex: number,
): Promise<PaneContext> {
  const target = `${windowTarget}.${paneIndex}`;

  // Get workdir and program in parallel
  const [workdirResult, programResult, transcriptResult] = await Promise.all([
    execAsync(
      `tmux display-message -p -t '${target}' '#{pane_current_path}'`,
    ).catch(() => ({ stdout: "" })),
    execAsync(
      `tmux display-message -p -t '${target}' '#{pane_current_command}'`,
    ).catch(() => ({ stdout: "" })),
    execAsync(`tmux capture-pane -p -t '${target}' -S -50`).catch(() => ({
      stdout: "",
    })),
  ]);

  const workdir = workdirResult.stdout.trim();
  const program = programResult.stdout.trim();
  const transcript = transcriptResult.stdout.trimEnd();

  // Check for git branch and repo name (fails silently for non-git directories)
  let gitBranch: string | null = null;
  let gitRepoName: string | null = null;
  if (workdir) {
    // Get branch and remote URL in parallel, with individual error handling
    // so that a missing remote doesn't prevent us from getting the branch
    const [branchResult, remoteResult] = await Promise.all([
      execAsync(`git -C '${workdir}' branch --show-current 2>/dev/null`).catch(
        () => ({ stdout: "" }),
      ),
      // Get remote origin URL to extract repo name (works correctly for worktrees)
      execAsync(`git -C '${workdir}' remote get-url origin 2>/dev/null`).catch(
        () => ({ stdout: "" }),
      ),
    ]);
    const branch = branchResult.stdout.trim();
    if (branch) {
      gitBranch = branch;
    }
    // Parse repo name from remote URL
    // Handles formats like:
    // - git@github.com:org/repo.git
    // - https://github.com/org/repo.git
    // - https://github.com/org/repo
    // - /path/to/local/repo
    const remoteUrl = remoteResult.stdout.trim();
    if (remoteUrl) {
      gitRepoName = extractRepoNameFromUrl(remoteUrl);
    }
  }

  return {
    workdir,
    program,
    transcript,
    gitBranch,
    gitRepoName,
  };
}

/**
 * Get rich context for all panes in a window.
 */
export async function getWindowContext(
  windowIndex: number,
): Promise<WindowContext> {
  const windowTarget = `:${windowIndex}`;

  // Get window name, pane list, and active pane info
  // #{pane_active} is 1 for the active pane, 0 otherwise
  const [nameResult, panesResult] = await Promise.all([
    execAsync(`tmux display-message -p -t '${windowTarget}' '#{window_name}'`),
    execAsync(
      `tmux list-panes -t '${windowTarget}' -F '#{pane_index}:#{pane_active}'`,
    ),
  ]);

  const windowName = nameResult.stdout.trim();
  const paneLines = panesResult.stdout.trim().split("\n");

  // Parse pane indices and find active pane
  let activePaneIndex = 0;
  const paneIndices: number[] = [];

  for (const line of paneLines) {
    const [indexStr, activeStr] = line.split(":");
    const paneIndex = Number(indexStr);
    paneIndices.push(paneIndex);
    if (activeStr === "1") {
      // Store position in our panes array (0-based index into the array)
      activePaneIndex = paneIndices.length - 1;
    }
  }

  // Get context for all panes in parallel
  const panes = await Promise.all(
    paneIndices.map((paneIndex) => getPaneContext(windowTarget, paneIndex)),
  );

  return {
    windowIndex,
    windowName,
    panes,
    activePaneIndex,
  };
}
