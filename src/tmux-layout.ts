/**
 * tmux layout string generator.
 *
 * Layout string format:
 *   checksum,WxH,x,y,pane_id           - single pane
 *   checksum,WxH,x,y{child,child,...}  - horizontal split (side by side)
 *   checksum,WxH,x,y[child,child,...]  - vertical split (stacked)
 *
 * The checksum is a 4-character hex value computed from the layout string.
 */

export interface LayoutPane {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutNode {
  x: number;
  y: number;
  width: number;
  height: number;
  paneId?: string;
  splitType?: "horizontal" | "vertical";
  children?: LayoutNode[];
}

/**
 * Calculate tmux layout checksum.
 */
function calculateChecksum(layout: string): string {
  let csum = 0;
  for (let i = 0; i < layout.length; i++) {
    csum = (csum >> 1) + ((csum & 1) << 15);
    csum += layout.charCodeAt(i);
    csum &= 0xffff;
  }
  return csum.toString(16).padStart(4, "0");
}

/**
 * Build a layout node tree from a flat list of panes.
 */
function buildLayoutTree(
  panes: LayoutPane[],
  x: number,
  y: number,
  width: number,
  height: number,
): LayoutNode {
  if (panes.length === 0) {
    throw new Error("No panes provided");
  }

  if (panes.length === 1) {
    const pane = panes[0];
    return {
      x: pane.x,
      y: pane.y,
      width: pane.width,
      height: pane.height,
      paneId: pane.id,
    };
  }

  // Find unique x and y positions
  const xPositions = [...new Set(panes.map((p) => p.x))].sort((a, b) => a - b);
  const yPositions = [...new Set(panes.map((p) => p.y))].sort((a, b) => a - b);

  // Try horizontal split first (side by side, different x)
  if (xPositions.length > 1) {
    const columns: Map<number, LayoutPane[]> = new Map();
    for (const pane of panes) {
      let colX = xPositions[0];
      for (const xPos of xPositions) {
        if (pane.x >= xPos) colX = xPos;
      }
      if (!columns.has(colX)) columns.set(colX, []);
      columns.get(colX)?.push(pane);
    }

    if (columns.size > 1) {
      const children: LayoutNode[] = [];

      for (const colX of [...columns.keys()].sort((a, b) => a - b)) {
        const colPanes = columns.get(colX);
        if (!colPanes) continue;
        const colWidth = Math.max(...colPanes.map((p) => p.x + p.width)) - colX;
        const child = buildLayoutTree(colPanes, colX, y, colWidth, height);
        children.push(child);
      }

      return {
        x,
        y,
        width,
        height,
        splitType: "horizontal",
        children,
      };
    }
  }

  // Try vertical split (stacked, different y)
  if (yPositions.length > 1) {
    const rows: Map<number, LayoutPane[]> = new Map();
    for (const pane of panes) {
      let rowY = yPositions[0];
      for (const yPos of yPositions) {
        if (pane.y >= yPos) rowY = yPos;
      }
      if (!rows.has(rowY)) rows.set(rowY, []);
      rows.get(rowY)?.push(pane);
    }

    if (rows.size > 1) {
      const children: LayoutNode[] = [];

      for (const rowY of [...rows.keys()].sort((a, b) => a - b)) {
        const rowPanes = rows.get(rowY);
        if (!rowPanes) continue;
        const rowHeight =
          Math.max(...rowPanes.map((p) => p.y + p.height)) - rowY;
        const child = buildLayoutTree(rowPanes, x, rowY, width, rowHeight);
        children.push(child);
      }

      return {
        x,
        y,
        width,
        height,
        splitType: "vertical",
        children,
      };
    }
  }

  // Fallback
  return {
    x,
    y,
    width,
    height,
    paneId: panes[0].id,
  };
}

/**
 * Serialize a layout tree to tmux layout string format (without checksum).
 */
function serializeLayoutNode(node: LayoutNode): string {
  const base = `${node.width}x${node.height},${node.x},${node.y}`;

  if (node.paneId !== undefined) {
    const paneNum = node.paneId.replace("%", "");
    return `${base},${paneNum}`;
  }

  if (node.children && node.children.length > 0) {
    const childStr = node.children.map(serializeLayoutNode).join(",");
    if (node.splitType === "horizontal") {
      return `${base}{${childStr}}`;
    } else {
      return `${base}[${childStr}]`;
    }
  }

  throw new Error("Invalid node: no paneId and no children");
}

/**
 * Generate a complete tmux layout string with checksum.
 */
export function generateLayoutString(
  panes: LayoutPane[],
  windowWidth: number,
  windowHeight: number,
): string {
  const tree = buildLayoutTree(panes, 0, 0, windowWidth, windowHeight);
  const layout = serializeLayoutNode(tree);
  const checksum = calculateChecksum(layout);
  return `${checksum},${layout}`;
}
