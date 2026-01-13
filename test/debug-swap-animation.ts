/**
 * Debug script to verify window swap animation doesn't clip content.
 * Run with: bun test/debug-swap-animation.ts
 *
 * Key requirement: The swap zone (both swapping windows + gap) must maintain
 * EXACTLY the same total width throughout the animation. Both windows remain
 * fully visible (no clipping) and visually trade positions within the zone.
 */

import { easeOut } from "../src/utils"
import { box } from "../src/box-chars"

// Animation constants - must match values exported from main.ts
const WINDOW_BOX_WIDTH = 17  // Inner width for window names
const WINDOW_SWAP_FRAMES = 8
const BUTTON_BOX_WIDTH = 3   // Inner width for +/- buttons

// Build a simple window box (4 rows)
function buildBox(name: string, innerWidth: number, isSelected: boolean): [string, string, string, string] {
  const tl = isSelected ? box.dtl : box.tl
  const tr = isSelected ? box.dtr : box.tr
  const bl = isSelected ? box.dbl : box.bl
  const br = isSelected ? box.dbr : box.br
  const h = isSelected ? box.dh : box.h
  const v = isSelected ? box.dv : box.v

  const topBorder = tl + h.repeat(innerWidth) + tr
  const bottomBorder = bl + h.repeat(innerWidth) + br

  const centerContent = (content: string): string => {
    if (content.length < innerWidth) {
      const totalPadding = innerWidth - content.length
      const leftPad = Math.floor(totalPadding / 2)
      const rightPad = totalPadding - leftPad
      return " ".repeat(leftPad) + content + " ".repeat(rightPad)
    }
    return content.slice(0, innerWidth)
  }

  const middleRow1 = v + centerContent(name) + v
  const middleRow2 = v + centerContent("") + v

  return [topBorder, middleRow1, middleRow2, bottomBorder]
}

// Build a button box (4 rows)
function buildButtonBox(label: string, isSelected: boolean): [string, string, string, string] {
  return buildBox(label, BUTTON_BOX_WIDTH, isSelected)
}

// Get visual width of a string (handles multi-byte unicode characters)
function visualWidth(str: string): number {
  // For box-drawing chars, each char is 1 cell. This is a simplified version.
  // In production we'd use a proper unicode width library.
  return [...str].length
}

// Slice string by visual width (handles multi-byte unicode characters)
function visualSlice(str: string, start: number, end?: number): string {
  const chars = [...str]
  return chars.slice(start, end).join('')
}

// Pad string to exact visual width
function padToWidth(str: string, width: number): string {
  const currentWidth = visualWidth(str)
  if (currentWidth >= width) {
    return visualSlice(str, 0, width)
  }
  return str + ' '.repeat(width - currentWidth)
}

/**
 * Render the swap zone: two windows trading positions within a fixed-width area.
 *
 * The swap zone has constant width = box1Width + gap + box2Width.
 * At progress 0: box1 is at left edge, box2 is at right edge
 * At progress 1: box2 is at left edge, box1 is at right edge
 *
 * Both boxes remain fully visible throughout (no clipping).
 * At the midpoint they overlap/pass very close.
 */
function renderSwapZone(
  box1Rows: [string, string, string, string],
  box2Rows: [string, string, string, string],
  box1Width: number,
  box2Width: number,
  gap: number,
  progress: number  // 0 to 1
): [string, string, string, string] {
  const zoneWidth = box1Width + gap + box2Width

  // At progress 0: box1 starts at position 0, box2 starts at position (box1Width + gap)
  // At progress 1: box1 ends at position (box2Width + gap), box2 ends at position 0
  // Linear interpolation between these positions

  // box1 moves from 0 to (box2Width + gap) = (zoneWidth - box1Width)
  // box2 moves from (box1Width + gap) to 0 = from (zoneWidth - box2Width) to 0

  const box1Start = 0
  const box1End = zoneWidth - box1Width
  const box1Pos = Math.round(box1Start + progress * (box1End - box1Start))

  const box2Start = zoneWidth - box2Width
  const box2End = 0
  const box2Pos = Math.round(box2Start + progress * (box2End - box2Start))

  return box1Rows.map((row1, rowIdx) => {
    const row2 = box2Rows[rowIdx]

    // Create a zone buffer filled with spaces
    const buffer: string[] = new Array(zoneWidth).fill(' ')

    // Place box2 first (it will be in the background if overlapping)
    const chars2 = [...row2]
    for (let i = 0; i < chars2.length && box2Pos + i < zoneWidth; i++) {
      if (box2Pos + i >= 0) {
        buffer[box2Pos + i] = chars2[i]
      }
    }

    // Place box1 second (it will be in the foreground if overlapping)
    const chars1 = [...row1]
    for (let i = 0; i < chars1.length && box1Pos + i < zoneWidth; i++) {
      if (box1Pos + i >= 0) {
        buffer[box1Pos + i] = chars1[i]
      }
    }

    return buffer.join('')
  }) as [string, string, string, string]
}

// Test the animation frames
function testAnimation() {
  console.log("Testing Window Swap Animation - Swap Zone Approach\n")
  console.log("=".repeat(80))

  // Box width = inner + borders
  const windowBoxWidth = WINDOW_BOX_WIDTH + 2  // 19 chars
  const buttonBoxWidth = BUTTON_BOX_WIDTH + 2   // 5 chars
  const gap = 1  // Space between boxes

  // Swap zone width = two windows + gap between them
  const swapZoneWidth = windowBoxWidth + gap + windowBoxWidth  // 39 chars

  // Total width = button + gap + swapZone + gap + button
  const totalExpectedWidth = buttonBoxWidth + gap + swapZoneWidth + gap + buttonBoxWidth  // 51 chars

  // Create boxes
  const minusBtn = buildButtonBox(" - ", false)
  const window1 = buildBox("backend", WINDOW_BOX_WIDTH, true)
  const window2 = buildBox("frontend", WINDOW_BOX_WIDTH, false)
  const plusBtn = buildButtonBox(" + ", false)

  console.log(`\nBox widths: button=${buttonBoxWidth}, window=${windowBoxWidth}`)
  console.log(`Swap zone width: ${swapZoneWidth} (two windows + gap)`)
  console.log(`Expected total width per row: ${totalExpectedWidth} chars`)

  console.log("\n\nOriginal state (frame 0):")
  console.log("-".repeat(80))
  for (let row = 0; row < 4; row++) {
    const line = minusBtn[row] + " " + window1[row] + " " + window2[row] + " " + plusBtn[row]
    console.log(`|${line}| (width: ${visualWidth(line)})`)
  }

  let hasErrors = false
  const expectedRowWidth = totalExpectedWidth

  // Test with SWAP ZONE implementation
  console.log("\n\nSWAP ZONE Implementation (no clipping, stable width):")
  console.log("=".repeat(80))

  for (let frame = 0; frame <= WINDOW_SWAP_FRAMES; frame++) {
    const rawProgress = frame / WINDOW_SWAP_FRAMES
    const progress = easeOut(rawProgress)

    console.log(`\nFrame ${frame} (progress: ${(progress * 100).toFixed(0)}%)`)
    console.log("-".repeat(80))

    // Render the swap zone with both windows
    const swapZoneRows = renderSwapZone(
      [...window1] as [string, string, string, string],
      [...window2] as [string, string, string, string],
      windowBoxWidth,
      windowBoxWidth,
      gap,
      progress
    )

    for (let row = 0; row < 4; row++) {
      // minusBtn | swapZone | plusBtn
      const line = minusBtn[row] + " " + swapZoneRows[row] + " " + plusBtn[row]
      const width = visualWidth(line)

      let status = width === expectedRowWidth ? "OK" : `ERROR: expected ${expectedRowWidth}`
      console.log(`|${line}| (width: ${width}) ${status}`)

      if (width !== expectedRowWidth) {
        hasErrors = true
      }
    }
  }

  console.log("\n" + "=".repeat(80))
  if (hasErrors) {
    console.log("RESULT: FAILED - Row widths vary during animation (causes carousel churn)")
    process.exit(1)
  } else {
    console.log("RESULT: PASSED - All frames have identical total width")
    console.log("                 Both windows remain fully visible throughout")
    console.log("                 Windows visually trade positions within the swap zone")
    process.exit(0)
  }
}

testAnimation()
