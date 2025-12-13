/**
 * Layout templates for different pane counts.
 * Each layout is a tree of splits that can be applied to a window.
 */

export interface PaneLayout {
  // Normalized position and size (0-1 range)
  // Use negative height to indicate absolute rows (e.g., -10 = 10 rows)
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutTemplate {
  name: string;
  panes: PaneLayout[];
}

// Absolute min height in rows for short panes (watch/logs)
const MIN_ROWS = 6;

// Helper to create a layout with a min-height bottom pane
// Returns [main pane, bottom pane] for one column
function withMinBottom(x: number, width: number): [PaneLayout, PaneLayout] {
  return [
    { x, y: 0, width, height: -MIN_ROWS }, // negative = "fill remaining after min"
    { x, y: -MIN_ROWS, width, height: MIN_ROWS }, // positive int = absolute rows (handled specially)
  ];
}

// 1 pane - full screen
const layouts1: LayoutTemplate[] = [
  {
    name: "full",
    panes: [{ x: 0, y: 0, width: 1, height: 1 }],
  },
];

// 2 panes - vertical split
const layouts2: LayoutTemplate[] = [
  {
    name: "50/50",
    panes: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
  },
];

// 3 panes - vertical split, then one side gets split
const layouts3: LayoutTemplate[] = [
  {
    name: "left + right with bottom",
    panes: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: -MIN_ROWS },
      { x: 0.5, y: -MIN_ROWS, width: 0.5, height: MIN_ROWS },
    ],
  },
  {
    name: "left with bottom + right",
    panes: [
      { x: 0, y: 0, width: 0.5, height: -MIN_ROWS },
      { x: 0, y: -MIN_ROWS, width: 0.5, height: MIN_ROWS },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
  },
  {
    name: "left + right stacked",
    panes: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ],
  },
  {
    name: "left stacked + right",
    panes: [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
  },
];

// 4 panes - vertical split, both sides get bottom strips or one is min height
const layouts4: LayoutTemplate[] = [
  {
    name: "both with bottom",
    panes: [
      { x: 0, y: 0, width: 0.5, height: -MIN_ROWS },
      { x: 0, y: -MIN_ROWS, width: 0.5, height: MIN_ROWS },
      { x: 0.5, y: 0, width: 0.5, height: -MIN_ROWS },
      { x: 0.5, y: -MIN_ROWS, width: 0.5, height: MIN_ROWS },
    ],
  },
  {
    name: "left min + right stacked",
    panes: [
      { x: 0, y: 0, width: 0.5, height: -MIN_ROWS },
      { x: 0, y: -MIN_ROWS, width: 0.5, height: MIN_ROWS },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ],
  },
  {
    name: "left stacked + right min",
    panes: [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: -MIN_ROWS },
      { x: 0.5, y: -MIN_ROWS, width: 0.5, height: MIN_ROWS },
    ],
  },
  {
    name: "both stacked",
    panes: [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ],
  },
];

const layoutsByCount: Record<number, LayoutTemplate[]> = {
  1: layouts1,
  2: layouts2,
  3: layouts3,
  4: layouts4,
};

export function getLayoutsForCount(count: number): LayoutTemplate[] | null {
  return layoutsByCount[count] || null;
}

/**
 * Convert a layout template to absolute coordinates for a given window size.
 * Handles special values:
 * - Negative height: absolute rows (e.g., -6 means fill remaining minus 6 rows)
 * - Negative y: positioned from bottom
 *
 * Accounts for 1-character separators between panes.
 */
export function resolveLayout(
  template: LayoutTemplate,
  windowWidth: number,
  windowHeight: number
): { x: number; y: number; width: number; height: number }[] {
  // First pass: identify unique columns and rows to count separators
  const xPositions = [...new Set(template.panes.map(p => p.x))].sort((a, b) => a - b);
  const numVSeparators = xPositions.length - 1; // vertical separators between columns
  const usableWidth = windowWidth - numVSeparators;

  // For each column, count horizontal separators
  const columns = new Map<number, number[]>();
  for (const pane of template.panes) {
    if (!columns.has(pane.x)) columns.set(pane.x, []);
    columns.get(pane.x)!.push(pane.y);
  }

  return template.panes.map((pane) => {
    // Calculate x position accounting for separators
    const colIndex = xPositions.indexOf(pane.x);
    const xBase = Math.floor(pane.x * usableWidth);
    const x = xBase + colIndex; // add separator offsets

    // Calculate width
    let width: number;
    if (pane.x + pane.width >= 1) {
      // Last column in its row - take remaining width
      width = windowWidth - x;
    } else {
      width = Math.floor(pane.width * usableWidth);
    }

    // Get y positions in this column to count horizontal separators
    const yPositionsInCol = [...new Set(
      template.panes
        .filter(p => p.x === pane.x)
        .map(p => p.y)
    )].sort((a, b) => a - b);
    const numHSeparators = yPositionsInCol.length - 1;
    const usableHeight = windowHeight - numHSeparators;

    // Calculate y position
    let y: number;
    const rowIndex = yPositionsInCol.indexOf(pane.y);

    if (pane.y < 0) {
      // Negative y: position from bottom
      const absRows = Math.abs(pane.y);
      y = windowHeight - absRows;
    } else if (pane.y <= 1) {
      const yBase = Math.floor(pane.y * usableHeight);
      y = yBase + rowIndex; // add separator offsets
    } else {
      y = pane.y;
    }

    // Calculate height
    let height: number;
    if (pane.height < 0 && pane.height > -1) {
      height = Math.floor(Math.abs(pane.height) * usableHeight);
    } else if (pane.height < 0) {
      // Negative integer: fill remaining after reserving that many rows + separator
      const reservedRows = Math.abs(pane.height);
      height = windowHeight - reservedRows - 1; // -1 for separator
    } else if (pane.height <= 1) {
      if (pane.y + pane.height >= 1) {
        // Last row - take remaining height
        height = windowHeight - y;
      } else {
        height = Math.floor(pane.height * usableHeight);
      }
    } else {
      height = pane.height;
    }

    return { x, y, width, height };
  });
}
