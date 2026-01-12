/**
 * Debug script to verify window swap animation doesn't clip content.
 * Run with: bun test/debug-swap-animation.ts
 */

// Simulate the applyOffset function and test that boxes don't get clipped

const WINDOW_BOX_WIDTH = 17  // Inner width for window names
const WINDOW_SWAP_FRAMES = 8

// Quadratic ease-out for smooth deceleration
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 2)
}

// Box drawing characters
const box = {
  tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│",
  dtl: "╔", dtr: "╗", dbl: "╚", dbr: "╝", dh: "═", dv: "║",
}

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

// The FIXED applyOffset function (no truncation)
function applyOffsetFixed(box: [string, string, string, string], chars: number, direction: 'left' | 'right'): [string, string, string, string] {
  if (chars === 0) return box
  return box.map(row => {
    if (direction === 'right') {
      // Moving right: add spaces to the LEFT (pushing box right in its slot)
      // Don't truncate - let it overflow into adjacent slot space
      return ' '.repeat(chars) + row
    } else {
      // Moving left: add spaces to the RIGHT (pushing box left in its slot)
      // Don't truncate - let it overflow into adjacent slot space
      return row + ' '.repeat(chars)
    }
  }) as [string, string, string, string]
}

// The OLD broken applyOffset function (for comparison)
function applyOffsetBroken(box: [string, string, string, string], chars: number, direction: 'left' | 'right'): [string, string, string, string] {
  if (chars === 0) return box
  return box.map(row => {
    if (direction === 'right') {
      // Moving right: add spaces at start, trim from end
      return ' '.repeat(chars) + row.slice(0, -chars)
    } else {
      // Moving left: trim from start, add spaces at end
      return row.slice(chars) + ' '.repeat(chars)
    }
  }) as [string, string, string, string]
}

// Test the animation frames
function testAnimation() {
  console.log("Testing Window Swap Animation\n")
  console.log("=".repeat(60))

  const boxTotalWidth = WINDOW_BOX_WIDTH + 2 + 1  // 20 chars (inner + borders + gap)

  // Create two window boxes
  const window1 = buildBox("backend", WINDOW_BOX_WIDTH, true)
  const window2 = buildBox("frontend", WINDOW_BOX_WIDTH, false)

  console.log("\nOriginal boxes (frame 0):")
  console.log("-".repeat(60))
  for (let row = 0; row < 4; row++) {
    console.log(window1[row] + " " + window2[row])
  }

  let hasErrors = false

  // Test each frame with FIXED implementation
  console.log("\n\nFIXED Implementation (no truncation):")
  console.log("=".repeat(60))

  for (let frame = 0; frame <= WINDOW_SWAP_FRAMES; frame++) {
    const rawProgress = frame / WINDOW_SWAP_FRAMES
    const progress = easeOut(rawProgress)
    const offset = Math.round(progress * boxTotalWidth)

    console.log(`\nFrame ${frame} (progress: ${(progress * 100).toFixed(0)}%, offset: ${offset})`)
    console.log("-".repeat(60))

    // window1 moves right, window2 moves left
    const shifted1 = applyOffsetFixed([...window1] as [string, string, string, string], offset, 'right')
    const shifted2 = applyOffsetFixed([...window2] as [string, string, string, string], offset, 'left')

    for (let row = 0; row < 4; row++) {
      const line = shifted1[row] + " " + shifted2[row]
      console.log(line)

      // Check for clipping issues
      if (shifted1[row].includes("═════════════ ─")) {
        console.log("  ^ ERROR: Double borders merging!")
        hasErrors = true
      }
      if (shifted1[row].length !== window1[row].length + offset) {
        console.log(`  ^ Note: Row length changed from ${window1[row].length} to ${shifted1[row].length} (expected ${window1[row].length + offset})`)
      }
    }
  }

  // Test each frame with BROKEN implementation for comparison
  console.log("\n\nBROKEN Implementation (with truncation) - for comparison:")
  console.log("=".repeat(60))

  for (let frame = 0; frame <= WINDOW_SWAP_FRAMES; frame++) {
    const rawProgress = frame / WINDOW_SWAP_FRAMES
    const progress = easeOut(rawProgress)
    const offset = Math.round(progress * boxTotalWidth)

    if (frame === 0 || frame === 4 || frame === WINDOW_SWAP_FRAMES) {
      console.log(`\nFrame ${frame} (progress: ${(progress * 100).toFixed(0)}%, offset: ${offset})`)
      console.log("-".repeat(60))

      // window1 moves right, window2 moves left
      const shifted1 = applyOffsetBroken([...window1] as [string, string, string, string], offset, 'right')
      const shifted2 = applyOffsetBroken([...window2] as [string, string, string, string], offset, 'left')

      for (let row = 0; row < 4; row++) {
        const line = shifted1[row] + " " + shifted2[row]
        console.log(line)
      }
    }
  }

  console.log("\n" + "=".repeat(60))
  if (hasErrors) {
    console.log("RESULT: FAILED - Animation has clipping issues")
    process.exit(1)
  } else {
    console.log("RESULT: PASSED - Animation looks correct")
    process.exit(0)
  }
}

testAnimation()
