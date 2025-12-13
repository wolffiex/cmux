import type { WindowInfo, PaneInfo } from "./tmux.ts";
import { Font } from "./fonts.ts";

export interface MinimapOptions {
  width: number;
  height: number;
}

const HOMEROW_KEYS = "ASDFGHJKL";

// Lazy-load the font
let miniFont: Font | null = null;
function getFont(): Font {
  if (!miniFont) {
    miniFont = new Font("mini");
  }
  return miniFont;
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

  const font = getFont();

  // Draw each pane
  panes.forEach((pane, index) => {
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

    // Draw homerow label centered using mini font
    const label = HOMEROW_KEYS[index];
    if (label) {
      const labelLines = font.render(label);
      const labelWidth = Math.max(...labelLines.map(l => l.length));
      const labelHeight = labelLines.length;

      // Calculate center position
      const innerWidth = x2 - x1 - 1;
      const innerHeight = y2 - y1 - 1;
      const startX = x1 + 1 + Math.floor((innerWidth - labelWidth) / 2);
      const startY = y1 + 1 + Math.floor((innerHeight - labelHeight) / 2);

      // Draw label if it fits
      if (labelWidth <= innerWidth && labelHeight <= innerHeight) {
        for (let ly = 0; ly < labelLines.length; ly++) {
          const line = labelLines[ly];
          for (let lx = 0; lx < line.length; lx++) {
            const gx = startX + lx;
            const gy = startY + ly;
            if (gx > x1 && gx < x2 && gy > y1 && gy < y2 && line[lx] !== ' ') {
              grid[gy][gx] = line[lx];
            }
          }
        }
      }
    }
  });

  return grid.map((row) => row.join(""));
}

// Export for use by cmuxx-ui to handle keypresses
export { HOMEROW_KEYS };
