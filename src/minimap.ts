import type { WindowInfo, PaneInfo } from "./tmux.ts";

export interface MinimapOptions {
  width: number;
  height: number;
}

export function renderMinimap(window: WindowInfo, options: MinimapOptions): string[] {
  const { width: mapWidth, height: mapHeight } = options;
  const { width: winWidth, height: winHeight, panes } = window;

  // Scale factors
  const scaleX = mapWidth / winWidth;
  const scaleY = mapHeight / winHeight;

  // Initialize grid with spaces
  const grid: string[][] = Array.from({ length: mapHeight }, () =>
    Array(mapWidth).fill(" ")
  );

  // Draw each pane
  for (const pane of panes) {
    const x1 = Math.floor(pane.left * scaleX);
    const y1 = Math.floor(pane.top * scaleY);
    const x2 = Math.floor((pane.left + pane.width) * scaleX) - 1;
    const y2 = Math.floor((pane.top + pane.height) * scaleY) - 1;

    // Draw borders
    for (let x = x1; x <= x2; x++) {
      if (y1 >= 0 && y1 < mapHeight) grid[y1][x] = "─";
      if (y2 >= 0 && y2 < mapHeight) grid[y2][x] = "─";
    }
    for (let y = y1; y <= y2; y++) {
      if (x1 >= 0 && x1 < mapWidth) grid[y][x1] = "│";
      if (x2 >= 0 && x2 < mapWidth) grid[y][x2] = "│";
    }

    // Corners
    if (y1 >= 0 && y1 < mapHeight && x1 >= 0 && x1 < mapWidth) grid[y1][x1] = "┌";
    if (y1 >= 0 && y1 < mapHeight && x2 >= 0 && x2 < mapWidth) grid[y1][x2] = "┐";
    if (y2 >= 0 && y2 < mapHeight && x1 >= 0 && x1 < mapWidth) grid[y2][x1] = "└";
    if (y2 >= 0 && y2 < mapHeight && x2 >= 0 && x2 < mapWidth) grid[y2][x2] = "┘";

    // Draw pane title centered
    if (pane.title) {
      const centerX = Math.floor((x1 + x2) / 2);
      const centerY = Math.floor((y1 + y2) / 2);
      const title = pane.title.slice(0, x2 - x1 - 1);
      const startX = centerX - Math.floor(title.length / 2);
      for (let i = 0; i < title.length; i++) {
        const tx = startX + i;
        if (tx > x1 && tx < x2 && centerY > y1 && centerY < y2) {
          grid[centerY][tx] = title[i];
        }
      }
    }
  }

  return grid.map((row) => row.join(""));
}
