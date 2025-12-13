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
  const sizeOutput = execSync(
    "tmux display-message -p '#{window_width} #{window_height}'"
  )
    .toString()
    .trim();
  const [width, height] = sizeOutput.split(" ").map(Number);

  const paneFormat =
    "#{pane_id}:#{pane_width}:#{pane_height}:#{pane_left}:#{pane_top}:#{pane_title}";
  const panesOutput = execSync(`tmux list-panes -F '${paneFormat}'`)
    .toString()
    .trim();

  const panes = panesOutput.split("\n").map((line) => {
    const [id, paneWidth, paneHeight, left, top, title] = line.split(":");
    return {
      id,
      width: Number(paneWidth),
      height: Number(paneHeight),
      left: Number(left),
      top: Number(top),
      title: title || "",
    };
  });

  return { width, height, panes };
}
