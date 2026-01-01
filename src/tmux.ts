import { execSync } from "node:child_process";

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
  const format = "#{window_width}:#{window_height}:#{pane_id}:#{pane_width}:#{pane_height}:#{pane_left}:#{pane_top}:#{pane_title}";
  const output = execSync(`tmux list-panes -F '${format}'`)
    .toString()
    .trim();

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
  const format = "#{window_index}:#{window_name}:#{window_active}:#{window_bell_flag}:#{window_activity_flag}:#{pane_current_command}";
  const output = execSync(`tmux list-windows -F '${format}'`)
    .toString()
    .trim();

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
 * Parse SSH host from a pane command like "ssh -t bongo cmux --remote"
 * Returns null if not an SSH command.
 */
export function getWindowHost(paneCommand: string): string | null {
  // Match patterns like:
  // - ssh host
  // - ssh -t host
  // - ssh user@host
  // - ssh -t user@host "..."
  const match = paneCommand.match(/^ssh\s+(?:-\w+\s+)*([^\s]+)/);
  if (!match) return null;

  const hostPart = match[1];
  // Extract just the host from user@host
  const atIndex = hostPart.indexOf("@");
  return atIndex >= 0 ? hostPart.slice(atIndex + 1) : hostPart;
}

/**
 * Query panes on a remote host via SSH.
 * Uses ControlMaster if configured by the user.
 */
export function getPanesRemote(host: string): PaneInfo[] {
  try {
    const format = "#{pane_id}:#{pane_width}:#{pane_height}:#{pane_left}:#{pane_top}:#{pane_title}";
    const output = execSync(
      `ssh ${host} "tmux list-panes -F '${format}'"`,
      { timeout: 5000 }
    )
      .toString()
      .trim();

    return output.split("\n").map((line) => {
      const [id, width, height, left, top, title] = line.split(":");
      return {
        id,
        width: Number(width),
        height: Number(height),
        left: Number(left),
        top: Number(top),
        title: title || "",
      };
    });
  } catch (e) {
    // SSH failed or remote tmux not running
    return [];
  }
}

/**
 * Get window dimensions from a remote host.
 */
export function getWindowInfoRemote(host: string): WindowInfo | null {
  try {
    const format = "#{window_width}:#{window_height}:#{pane_id}:#{pane_width}:#{pane_height}:#{pane_left}:#{pane_top}:#{pane_title}";
    const output = execSync(
      `ssh ${host} "tmux list-panes -F '${format}'"`,
      { timeout: 5000 }
    )
      .toString()
      .trim();

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
  } catch (e) {
    return null;
  }
}
