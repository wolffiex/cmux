import type { WindowInfo, PaneInfo } from "./tmux.ts";
import { Font } from "./fonts.ts";

export interface MinimapOptions {
  width: number;
  height: number;
}

const HOMEROW_KEYS = "ASDFGHJKL";

// Minimum pane size in minimap (rows/cols) to ensure visibility
// Font is 4 lines tall, plus 2 for borders = 6 minimum
const MIN_PANE_HEIGHT = 6;

// Lazy-load the font
let miniFont: Font | null = null;
function getFont(): Font {
  if (!miniFont) {
    miniFont = new Font("mini");
  }
  return miniFont;
}

interface ColumnLayout {
  rows: number; // 1 or 2
  hasMinHeight: boolean; // if true, bottom row is min-height
}

function analyzeLayout(panes: PaneInfo[], winWidth: number, winHeight: number): {
  columns: ColumnLayout[];
  panesByColumn: PaneInfo[][];
} {
  // Group panes into columns (left/right based on x position)
  const leftPanes: PaneInfo[] = [];
  const rightPanes: PaneInfo[] = [];

  for (const pane of panes) {
    if (pane.left < winWidth / 2) {
      leftPanes.push(pane);
    } else {
      rightPanes.push(pane);
    }
  }

  // Sort by y position within each column
  leftPanes.sort((a, b) => a.top - b.top);
  rightPanes.sort((a, b) => a.top - b.top);

  const columns: ColumnLayout[] = [];
  const panesByColumn: PaneInfo[][] = [];

  if (leftPanes.length > 0) {
    const hasMinHeight = leftPanes.length === 2 &&
      leftPanes[1].height < winHeight * 0.3; // bottom pane is small
    columns.push({ rows: leftPanes.length, hasMinHeight });
    panesByColumn.push(leftPanes);
  }

  if (rightPanes.length > 0) {
    const hasMinHeight = rightPanes.length === 2 &&
      rightPanes[1].height < winHeight * 0.3;
    columns.push({ rows: rightPanes.length, hasMinHeight });
    panesByColumn.push(rightPanes);
  }

  return { columns, panesByColumn };
}

export function renderMinimap(window: WindowInfo, options: MinimapOptions): string[] {
  const { width: mapWidth, height: mapHeight } = options;
  const { width: winWidth, height: winHeight, panes } = window;

  if (panes.length === 0) {
    return Array(mapHeight).fill(" ".repeat(mapWidth));
  }

  const { columns, panesByColumn } = analyzeLayout(panes, winWidth, winHeight);
  const numCols = columns.length;

  // Calculate column widths (equal split with 1 char gap)
  const gap = numCols > 1 ? 1 : 0;
  const colWidth = Math.floor((mapWidth - gap) / numCols);
  const lastColWidth = mapWidth - (colWidth * (numCols - 1)) - gap;

  // Calculate total height needed
  // Find max rows needed across columns, accounting for min-height
  let totalHeight = mapHeight;
  for (const col of columns) {
    if (col.rows === 2) {
      // Need space for two panes + gap
      const minNeeded = col.hasMinHeight
        ? (mapHeight - MIN_PANE_HEIGHT - 1) + 1 + MIN_PANE_HEIGHT  // top + gap + min
        : MIN_PANE_HEIGHT * 2 + 1; // two mins + gap
      totalHeight = Math.max(totalHeight, minNeeded);
    }
  }

  // Initialize grid
  const grid: string[][] = Array.from({ length: totalHeight }, () =>
    Array(mapWidth).fill(" ")
  );

  const font = getFont();
  let paneIndex = 0;

  // Render each column
  for (let colIdx = 0; colIdx < numCols; colIdx++) {
    const col = columns[colIdx];
    const colPanes = panesByColumn[colIdx];
    const x1 = colIdx === 0 ? 0 : colWidth + gap;
    const x2 = colIdx === 0 ? colWidth - 1 : mapWidth - 1;
    const width = x2 - x1 + 1;

    if (col.rows === 1) {
      // Single pane fills the column
      drawPane(grid, x1, 0, x2, totalHeight - 1, HOMEROW_KEYS[paneIndex], font);
      paneIndex++;
    } else {
      // Two panes stacked
      let topHeight: number;
      let bottomHeight: number;

      if (col.hasMinHeight) {
        // Bottom is min-height
        bottomHeight = MIN_PANE_HEIGHT;
        topHeight = totalHeight - bottomHeight - 1; // -1 for gap
      } else {
        // Equal split
        topHeight = Math.floor((totalHeight - 1) / 2);
        bottomHeight = totalHeight - topHeight - 1;
      }

      // Top pane
      drawPane(grid, x1, 0, x2, topHeight - 1, HOMEROW_KEYS[paneIndex], font);
      paneIndex++;

      // Bottom pane (after gap)
      const bottomY1 = topHeight + 1;
      drawPane(grid, x1, bottomY1, x2, totalHeight - 1, HOMEROW_KEYS[paneIndex], font);
      paneIndex++;
    }
  }

  return grid.map(row => row.join(""));
}

function drawPane(
  grid: string[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
  font: Font
): void {
  const height = grid.length;
  const width = grid[0].length;

  // Draw borders
  for (let x = x1; x <= x2; x++) {
    if (y1 >= 0 && y1 < height && x >= 0 && x < width) grid[y1][x] = "─";
    if (y2 >= 0 && y2 < height && x >= 0 && x < width) grid[y2][x] = "─";
  }
  for (let y = y1; y <= y2; y++) {
    if (x1 >= 0 && x1 < width && y >= 0 && y < height) grid[y][x1] = "│";
    if (x2 >= 0 && x2 < width && y >= 0 && y < height) grid[y][x2] = "│";
  }

  // Corners
  if (y1 >= 0 && y1 < height && x1 >= 0 && x1 < width) grid[y1][x1] = "┌";
  if (y1 >= 0 && y1 < height && x2 >= 0 && x2 < width) grid[y1][x2] = "┐";
  if (y2 >= 0 && y2 < height && x1 >= 0 && x1 < width) grid[y2][x1] = "└";
  if (y2 >= 0 && y2 < height && x2 >= 0 && x2 < width) grid[y2][x2] = "┘";

  // Draw label centered
  if (label) {
    const labelLines = font.render(label);
    const labelWidth = Math.max(...labelLines.map(l => l.length));
    const labelHeight = labelLines.length;

    const innerWidth = x2 - x1 - 1;
    const innerHeight = y2 - y1 - 1;
    const startX = x1 + 1 + Math.floor((innerWidth - labelWidth) / 2);
    const startY = y1 + 1 + Math.floor((innerHeight - labelHeight) / 2);

    if (labelWidth <= innerWidth && labelHeight <= innerHeight) {
      for (let ly = 0; ly < labelLines.length; ly++) {
        const line = labelLines[ly];
        for (let lx = 0; lx < line.length; lx++) {
          const gx = startX + lx;
          const gy = startY + ly;
          if (gx > x1 && gx < x2 && gy > y1 && gy < y2 && line[lx] !== " ") {
            grid[gy][gx] = line[lx];
          }
        }
      }
    }
  }
}

// Export for use by cmuxx-ui to handle keypresses
export { HOMEROW_KEYS };
