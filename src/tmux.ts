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
