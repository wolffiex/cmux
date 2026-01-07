/**
 * Renders a layout template as ASCII art with box-drawing characters.
 */

import type { LayoutTemplate } from "./layouts"

import { box } from "./box-chars"

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Convert normalized layout panes (0-1 range) to pixel rects.
 */
function toRects(template: LayoutTemplate, width: number, height: number): Rect[] {
  return template.panes.map(pane => {
    // Handle negative y (from bottom)
    const py = pane.y < 0 ? 0.7 : pane.y
    // Handle negative/special heights
    const ph = (pane.height > 0 && pane.height <= 1) ? pane.height : 0.3

    return {
      x: Math.floor(pane.x * width),
      y: Math.floor(py * height),
      w: Math.floor(pane.width * width),
      h: Math.floor(ph * height),
    }
  })
}

/**
 * Render layout to a 2D character grid.
 */
export function renderLayoutPreview(
  template: LayoutTemplate,
  width: number,
  height: number
): string[] {
  // Initialize grid with spaces
  const grid: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => " ")
  )

  const rects = toRects(template, width, height)

  // Draw outer border
  drawBox(grid, 0, 0, width, height)

  // Find split points from pane boundaries
  const xSplits = new Set<number>()
  const ySplits = new Set<number>()

  for (const rect of rects) {
    if (rect.x > 0) xSplits.add(rect.x)
    if (rect.y > 0) ySplits.add(rect.y)
  }

  // Draw vertical splits
  for (const x of xSplits) {
    if (x > 0 && x < width - 1) {
      drawVLine(grid, x, 0, height)
    }
  }

  // Draw horizontal splits
  for (const y of ySplits) {
    if (y > 0 && y < height - 1) {
      // Find the x range for this horizontal split
      const panesAtY = rects.filter(r => r.y === y)
      for (const pane of panesAtY) {
        drawHLine(grid, pane.x, y, pane.w)
      }
    }
  }

  // Fix intersections
  fixIntersections(grid, width, height)

  // Sort panes by size: largest first
  const sortedRects = [...rects].map((r, i) => ({ ...r, origIndex: i, area: r.w * r.h }))
    .sort((a, b) => b.area - a.area)

  // Draw pane numbers in center of each pane (numbered by position)
  sortedRects.forEach((rect, i) => {
    const cx = rect.x + Math.floor(rect.w / 2)
    const cy = rect.y + Math.floor(rect.h / 2)
    if (cx > 0 && cx < width - 1 && cy > 0 && cy < height - 1) {
      grid[cy][cx] = String(i + 1)
    }
  })

  return grid.map(row => row.join(""))
}

function drawBox(grid: string[][], x: number, y: number, w: number, h: number): void {
  const maxY = grid.length - 1
  const maxX = grid[0].length - 1

  // Corners
  if (y <= maxY && x <= maxX) grid[y][x] = box.tl
  if (y <= maxY && x + w - 1 <= maxX) grid[y][x + w - 1] = box.tr
  if (y + h - 1 <= maxY && x <= maxX) grid[y + h - 1][x] = box.bl
  if (y + h - 1 <= maxY && x + w - 1 <= maxX) grid[y + h - 1][x + w - 1] = box.br

  // Top/bottom edges
  for (let i = x + 1; i < x + w - 1 && i <= maxX; i++) {
    if (y <= maxY) grid[y][i] = box.h
    if (y + h - 1 <= maxY) grid[y + h - 1][i] = box.h
  }

  // Left/right edges
  for (let j = y + 1; j < y + h - 1 && j <= maxY; j++) {
    if (x <= maxX) grid[j][x] = box.v
    if (x + w - 1 <= maxX) grid[j][x + w - 1] = box.v
  }
}

function drawVLine(grid: string[][], x: number, y: number, h: number): void {
  for (let j = y; j < y + h && j < grid.length; j++) {
    if (x < grid[0].length) {
      const current = grid[j][x]
      if (current === " ") {
        grid[j][x] = box.v
      }
    }
  }
}

function drawHLine(grid: string[][], x: number, y: number, w: number): void {
  if (y >= grid.length) return
  for (let i = x; i < x + w && i < grid[0].length; i++) {
    const current = grid[y][i]
    if (current === " ") {
      grid[y][i] = box.h
    }
  }
}

function fixIntersections(grid: string[][], width: number, height: number): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = grid[y][x]
      if (c !== box.h && c !== box.v) continue

      const up = y > 0 ? grid[y - 1][x] : null
      const down = y < height - 1 ? grid[y + 1][x] : null
      const left = x > 0 ? grid[y][x - 1] : null
      const right = x < width - 1 ? grid[y][x + 1] : null

      const hasUp = isVertical(up)
      const hasDown = isVertical(down)
      const hasLeft = isHorizontal(left)
      const hasRight = isHorizontal(right)

      // Determine intersection type
      if (hasUp && hasDown && hasLeft && hasRight) {
        grid[y][x] = box.cross
      } else if (hasUp && hasDown && hasRight && !hasLeft) {
        grid[y][x] = box.ltee
      } else if (hasUp && hasDown && hasLeft && !hasRight) {
        grid[y][x] = box.rtee
      } else if (hasLeft && hasRight && hasDown && !hasUp) {
        grid[y][x] = box.ttee
      } else if (hasLeft && hasRight && hasUp && !hasDown) {
        grid[y][x] = box.btee
      }
    }
  }
}

function isVertical(c: string | null): boolean {
  return c === box.v || c === box.ltee || c === box.rtee || c === box.cross ||
         c === box.tl || c === box.tr || c === box.bl || c === box.br ||
         c === box.ttee || c === box.btee
}

function isHorizontal(c: string | null): boolean {
  return c === box.h || c === box.ltee || c === box.rtee || c === box.cross ||
         c === box.tl || c === box.tr || c === box.bl || c === box.br ||
         c === box.ttee || c === box.btee
}

// For quick testing
if (import.meta.main) {
  const { ALL_LAYOUTS } = await import("./layouts")

  for (let i = 0; i < Math.min(6, ALL_LAYOUTS.length); i++) {
    const layout = ALL_LAYOUTS[i]
    console.log(`\n${layout.name} (${layout.panes.length} panes):`)
    const lines = renderLayoutPreview(layout, 20, 8)
    lines.forEach(line => console.log(line))
  }
}
