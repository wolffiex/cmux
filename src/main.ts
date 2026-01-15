import { execSync, spawn } from "node:child_process"
import { join } from "node:path"
import { ALL_LAYOUTS, resolveLayout, type LayoutTemplate } from "./layouts"
import { renderLayoutPreview } from "./layout-preview"
import { getWindows, getWindowInfo, getStartupInfo, type TmuxWindow } from "./tmux"
import { generateLayoutString } from "./tmux-layout"
import { matchPanesToSlots, type Pane, type Slot } from "./pane-matcher"
import { computeSwaps, executeSwaps } from "./swap-orchestrator"
import { initLog, log } from "./logger"
import { splitWindowName, stripAnsi, easeOut } from "./utils"
import { box } from "./box-chars"
import {
  type DirPickerState,
  type DirPickerResult,
  initDirPickerState,
  handleDirPickerKey,
  renderDirPicker,
} from "./dir-picker"

const CONFIG_PATH = join(import.meta.dir, "../config/tmux.conf")
const SELF_PATH = import.meta.path

// ── State ──────────────────────────────────────────────────────────────────
type Focus = "window" | "layout"
type AnimationDirection = "left" | "right" | null
type Mode = "main" | "dirPicker"

interface State {
  windows: TmuxWindow[]
  currentWindowIndex: number
  layoutIndex: number
  carouselIndex: number  // 0 = minus, 1..n = windows, n+1 = plus
  focus: Focus
  mode: Mode
  // Animation state (for layout)
  animating: boolean
  animationDirection: AnimationDirection
  animationFrame: number
  previousLayoutIndex: number
  // Window swap animation state
  windowSwapAnimating: boolean
  windowSwapDirection: AnimationDirection
  windowSwapFrame: number
  windowSwapFromIndex: number  // Index in windows array
  windowSwapToIndex: number    // Index in windows array
  // Delete confirmation state
  confirmingDelete: boolean
  // Directory picker state
  dirPicker: DirPickerState | null
}

/**
 * Renumber windows sequentially to eliminate gaps.
 * Uses tmux move-window -r which respects the session's base-index setting.
 */
function renumberWindows(): void {
  try {
    execSync('tmux move-window -r', { stdio: 'ignore' })
  } catch (e) {
    // Ignore errors (e.g., not in tmux)
  }
}

function initState(): State {
  let windows: TmuxWindow[] = []
  let currentWindowIndex = 0
  let layoutIndex = 0

  try {
    // Single batched tmux command for startup (combines renumber + list-windows + list-panes)
    const startupInfo = getStartupInfo()
    windows = startupInfo.windows
    currentWindowIndex = windows.findIndex(w => w.active)
    if (currentWindowIndex < 0) currentWindowIndex = 0

    // Find first layout with matching pane count
    layoutIndex = ALL_LAYOUTS.findIndex(l => l.panes.length === startupInfo.currentWindowPaneCount)
    if (layoutIndex < 0) layoutIndex = 0
  } catch (e) {
    // Not in tmux - use dummy data for testing
    windows = [
      { index: 0, name: "backend", active: true, bell: false, activity: false, paneCommand: "" },
      { index: 1, name: "frontend", active: false, bell: false, activity: false, paneCommand: "" },
      { index: 2, name: "logs", active: false, bell: false, activity: false, paneCommand: "" },
    ]
  }

  return {
    windows,
    currentWindowIndex,
    layoutIndex,
    carouselIndex: currentWindowIndex + 1,  // Start on current window (index 0 = minus)
    focus: "window",
    mode: "main",
    // Animation state (for layout)
    animating: false,
    animationDirection: null,
    animationFrame: 0,
    previousLayoutIndex: layoutIndex,
    // Window swap animation state
    windowSwapAnimating: false,
    windowSwapDirection: null,
    windowSwapFrame: 0,
    windowSwapFromIndex: -1,
    windowSwapToIndex: -1,
    // Delete confirmation state
    confirmingDelete: false,
    // Directory picker state
    dirPicker: null,
  }
}

// State is initialized lazily in runUI() after alt-screen switch for faster visual feedback
let state: State

// ── Benchmark mode ─────────────────────────────────────────────────────────
const BENCHMARK_MODE = !!process.env.CMUX_BENCHMARK

// ── Polling ────────────────────────────────────────────────────────────────
let pollInterval: Timer | null = null
const POLL_INTERVAL_MS = 1500

function windowsChanged(oldWindows: TmuxWindow[], newWindows: TmuxWindow[]): boolean {
  if (oldWindows.length !== newWindows.length) return true
  return oldWindows.some((w, i) =>
    w.name !== newWindows[i].name ||
    w.index !== newWindows[i].index ||
    w.active !== newWindows[i].active
  )
}

function startPolling(): void {
  pollInterval = setInterval(async () => {
    try {
      const newWindows = getWindows()
      if (windowsChanged(state.windows, newWindows)) {
        // Update current window index if active window changed
        const newActiveIndex = newWindows.findIndex(w => w.active)
        if (newActiveIndex >= 0 && state.currentWindowIndex !== newActiveIndex) {
          state.currentWindowIndex = newActiveIndex
        }
        // Clamp current index if windows were removed
        if (state.currentWindowIndex >= newWindows.length) {
          state.currentWindowIndex = Math.max(0, newWindows.length - 1)
        }
        state.windows = newWindows
        render()
      }
    } catch {
      // Ignore polling errors (e.g., not in tmux)
    }
  }, POLL_INTERVAL_MS)
}

function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

// ── ANSI helpers ───────────────────────────────────────────────────────────
const ESC = "\x1b"
const CSI = `${ESC}[`

const ansi = {
  clear: `${CSI}2J${CSI}H`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  altScreen: `${CSI}?1049h`,
  exitAltScreen: `${CSI}?1049l`,
  moveTo: (x: number, y: number) => `${CSI}${y + 1};${x + 1}H`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  reset: `${CSI}0m`,
  inverse: `${CSI}7m`,
  white: `${CSI}97m`,  // Bright white foreground
  red: `${CSI}91m`,    // Bright red foreground
}

// Superscript digits for window numbering
const superscript = ['⁰','¹','²','³','⁴','⁵','⁶','⁷','⁸','⁹']

// ── Layout rendering ───────────────────────────────────────────────────────
function drawLayoutPreview(
  template: LayoutTemplate,
  x: number,
  y: number,
  w: number,
  h: number
): string {
  const lines = renderLayoutPreview(template, w, h)
  let out = ""
  lines.forEach((line, i) => {
    out += ansi.moveTo(x, y + i) + line
  })
  return out
}

// ── Animation constants ────────────────────────────────────────────────────
const ANIMATION_FRAMES = 12
const ANIMATION_FRAME_MS = 16

// ── Animation rendering ────────────────────────────────────────────────────
function renderAnimationFrame(
  prevLayout: LayoutTemplate,
  nextLayout: LayoutTemplate,
  direction: AnimationDirection,
  frame: number,
  previewX: number,
  previewY: number,
  previewW: number,
  previewH: number
): string {
  // Render both layouts
  const prevLines = renderLayoutPreview(prevLayout, previewW, previewH)
  const nextLines = renderLayoutPreview(nextLayout, previewW, previewH)

  // Calculate offset based on animation progress (0 to 1)
  const progress = frame / ANIMATION_FRAMES
  // Use ease-out for smooth deceleration
  const eased = 1 - Math.pow(1 - progress, 2)
  const offset = Math.round(previewW * eased)

  let out = ""

  for (let row = 0; row < previewH; row++) {
    const prevLine = prevLines[row] || ""
    const nextLine = nextLines[row] || ""

    // Build the visible portion of this row
    let visibleChars = ""

    if (direction === "right") {
      // New layout slides in from right: prev moves left, next enters from right
      // At frame 0: show prev fully
      // At final frame: show next fully
      for (let col = 0; col < previewW; col++) {
        const sourceCol = col + offset
        if (sourceCol < previewW) {
          // Still showing prev layout (shifted left)
          visibleChars += prevLine[sourceCol] || " "
        } else {
          // Showing next layout entering from right
          const nextCol = sourceCol - previewW
          visibleChars += nextLine[nextCol] || " "
        }
      }
    } else {
      // direction === "left": New layout slides in from left
      // prev moves right, next enters from left
      for (let col = 0; col < previewW; col++) {
        const sourceCol = col - offset
        if (sourceCol >= 0) {
          // Still showing prev layout (shifted right)
          visibleChars += prevLine[sourceCol] || " "
        } else {
          // Showing next layout entering from left
          const nextCol = previewW + sourceCol
          visibleChars += nextLine[nextCol] || " "
        }
      }
    }

    out += ansi.moveTo(previewX, previewY + row) + visibleChars
  }

  return out
}

function startAnimation(direction: AnimationDirection): void {
  state.animating = true
  state.animationDirection = direction
  state.animationFrame = 0

  const prevLayout = ALL_LAYOUTS[state.previousLayoutIndex]
  const nextLayout = ALL_LAYOUTS[state.layoutIndex]

  const width = process.stdout.columns || 80
  const height = process.stdout.rows || 24
  const previewW = Math.min(width - 4, 40)
  const previewH = Math.min(height - 11, 12)  // Adjusted for taller 6-row carousel
  const previewX = Math.floor((width - previewW) / 2)
  const previewY = 8  // Start after carousel (6 rows) + separator (1 row) + gap (1 row)

  // Update the counter immediately (shows new layout info)
  const paneCount = nextLayout.panes.length
  const layoutFocused = state.focus === "layout"
  const counter = `${paneCount} pane${paneCount > 1 ? 's' : ''} · ${state.layoutIndex + 1}/${ALL_LAYOUTS.length}`
  let counterOut = ansi.moveTo(Math.floor((width - counter.length - 2) / 2), previewY + previewH)
  if (layoutFocused) counterOut += ansi.inverse
  counterOut += ` ${counter} `
  counterOut += ansi.reset
  process.stdout.write(counterOut)

  const tick = () => {
    state.animationFrame++

    if (state.animationFrame >= ANIMATION_FRAMES) {
      // Animation complete
      state.animating = false
      state.animationDirection = null
      render() // Full clean render
      return
    }

    // Render animation frame
    const out = renderAnimationFrame(
      prevLayout,
      nextLayout,
      direction,
      state.animationFrame,
      previewX,
      previewY,
      previewW,
      previewH
    )
    process.stdout.write(out)

    setTimeout(tick, ANIMATION_FRAME_MS)
  }

  setTimeout(tick, ANIMATION_FRAME_MS)
}

// ── Window swap animation constants (exported for test/debug-swap-animation.ts) ─
export const WINDOW_SWAP_FRAMES = 8
export const WINDOW_SWAP_FRAME_MS = 25  // 8 frames * 25ms = 200ms total
export const WINDOW_BOX_WIDTH = 17  // Inner width for window names
export const BUTTON_BOX_WIDTH = 3   // Inner width for +/- buttons

function startWindowSwapAnimation(fromIndex: number, toIndex: number, direction: AnimationDirection): void {
  state.windowSwapAnimating = true
  state.windowSwapDirection = direction
  state.windowSwapFrame = 0
  state.windowSwapFromIndex = fromIndex
  state.windowSwapToIndex = toIndex

  const tick = () => {
    state.windowSwapFrame++

    if (state.windowSwapFrame >= WINDOW_SWAP_FRAMES) {
      // Animation complete - now perform the actual swap
      state.windowSwapAnimating = false
      state.windowSwapDirection = null

      // Perform the tmux swap
      const fromWindow = state.windows[fromIndex]
      const toWindow = state.windows[toIndex]
      try {
        execSync(`tmux swap-window -d -s :${fromWindow.index} -t :${toWindow.index}`)
        // Renumber windows to eliminate gaps after swap
        renumberWindows()
        // Refresh window list
        state.windows = getWindows()
        // Update carousel to follow the swapped window
        state.carouselIndex = toIndex + 1  // +1 because 0 is minus button
        state.currentWindowIndex = toIndex
      } catch {
        // Ignore errors
      }
      render()
      return
    }

    // Render animation frame
    render()
    setTimeout(tick, WINDOW_SWAP_FRAME_MS)
  }

  setTimeout(tick, WINDOW_SWAP_FRAME_MS)
}

// ── Main render ────────────────────────────────────────────────────────────
function render(): void {
  const width = process.stdout.columns || 80
  const height = process.stdout.rows || 24

  let out = ansi.clear

  // Window carousel (6 rows tall with gray box outline, 2 content lines per box)
  const windowFocused = state.focus === "window"
  const maxIndex = state.windows.length + 1  // 0=minus, 1..n=windows, n+1=plus

  // Build the 4-row carousel content (each window/button is a bordered box with 2 content lines)
  // Note: WINDOW_BOX_WIDTH and BUTTON_BOX_WIDTH are module-level constants

  // Build arrays for each row of the carousel content
  let row0Parts: string[] = []  // Top borders
  let row1Parts: string[] = []  // Content line 1
  let row2Parts: string[] = []  // Content line 2
  let row3Parts: string[] = []  // Bottom borders

  // Helper to build a box element (returns 4 rows for 2-line content)
  // Selected items use double-line borders (bright/white), non-selected use single-line (dim/gray)
  // windowNumber is optional 1-indexed number to show as superscript in top-right corner
  // isRed renders with red styling for delete confirmation
  const buildBox = (
    lines: [string, string],  // Two content lines
    innerWidth: number,
    isSelected: boolean,
    isDim: boolean = false,
    windowNumber?: number,
    isRed: boolean = false
  ): [string, string, string, string] => {
    // Choose border characters based on selection state
    const tl = isSelected ? box.dtl : box.tl
    const tr = isSelected ? box.dtr : box.tr
    const bl = isSelected ? box.dbl : box.bl
    const br = isSelected ? box.dbr : box.br
    const h = isSelected ? box.dh : box.h
    const v = isSelected ? box.dv : box.v

    let topBorder: string
    if (windowNumber !== undefined && windowNumber >= 0 && windowNumber <= 9) {
      // Superscript replaces one horizontal char (no width compensation needed)
      topBorder = tl + h.repeat(innerWidth - 1) + superscript[windowNumber] + tr
    } else {
      topBorder = tl + h.repeat(innerWidth) + tr
    }
    const bottomBorder = bl + h.repeat(innerWidth) + br

    // Center each content line within innerWidth
    const centerContent = (content: string): string => {
      if (content.length < innerWidth) {
        const totalPadding = innerWidth - content.length
        const leftPad = Math.floor(totalPadding / 2)
        const rightPad = totalPadding - leftPad
        return " ".repeat(leftPad) + content + " ".repeat(rightPad)
      }
      return content.slice(0, innerWidth)
    }

    const middleRow1 = v + centerContent(lines[0]) + v
    const middleRow2 = v + centerContent(lines[1]) + v

    if (isRed) {
      // Red styling for delete confirmation
      return [
        ansi.red + topBorder + ansi.reset,
        ansi.red + middleRow1 + ansi.reset,
        ansi.red + middleRow2 + ansi.reset,
        ansi.red + bottomBorder + ansi.reset
      ]
    } else if (isSelected) {
      // Selected: bright white double-line borders
      return [
        ansi.white + topBorder + ansi.reset,
        ansi.white + middleRow1 + ansi.reset,
        ansi.white + middleRow2 + ansi.reset,
        ansi.white + bottomBorder + ansi.reset
      ]
    } else if (isDim) {
      // Dim: gray single-line borders
      return [
        ansi.dim + topBorder + ansi.reset,
        ansi.dim + middleRow1 + ansi.reset,
        ansi.dim + middleRow2 + ansi.reset,
        ansi.dim + bottomBorder + ansi.reset
      ]
    }
    // Default: normal single-line borders
    return [topBorder, middleRow1, middleRow2, bottomBorder]
  }

  // [−] button (always shows as normal button, delete confirmation appears inline in window)
  const isMinusSelected = windowFocused && state.carouselIndex === 0
  const [minusT, minusM1, minusM2, minusB] = buildBox([" − ", ""], BUTTON_BOX_WIDTH, isMinusSelected)
  row0Parts.push(minusT)
  row1Parts.push(minusM1)
  row2Parts.push(minusM2)
  row3Parts.push(minusB)

  // Window items (two lines: repo name on line 1, branch/path + indicator on line 2)
  // During swap animation, we render windows in swapped order based on animation progress
  const windowBoxes: [string, string, string, string][] = []

  for (let i = 0; i < state.windows.length; i++) {
    const win = state.windows[i]
    const isSelected = windowFocused && state.carouselIndex === i + 1
    const isCurrent = i === state.currentWindowIndex
    const isConfirmingThisWindow = state.confirmingDelete && isCurrent

    // Pass window number for superscript (1-indexed, 1-9 only)
    const windowNum = i < 9 ? i + 1 : undefined

    if (isConfirmingThisWindow) {
      // Show delete confirmation inline in this window's box
      windowBoxes.push(buildBox(["Delete?", "[⏎] yes [esc]"], WINDOW_BOX_WIDTH, true, false, windowNum, true))
    } else {
      const [line1, line2] = splitWindowName(win.name)
      // Add current indicator to line 2 (or line 1 if line 2 is empty)
      let displayLine1 = line1
      let displayLine2 = line2
      if (isCurrent) {
        if (line2) {
          displayLine2 += " ●"
        } else {
          displayLine1 += " ●"
        }
      }

      windowBoxes.push(buildBox([displayLine1, displayLine2], WINDOW_BOX_WIDTH, isSelected, false, windowNum))
    }
  }

  // During swap animation, render the two swapping windows as a combined "swap zone"
  // The swap zone has constant width = box1Width + gap + box2Width
  // Both windows slide within this zone, trading positions without clipping
  let swapZoneFromIdx = -1
  let swapZoneToIdx = -1
  let swapZoneRows: [string, string, string, string] | null = null

  if (state.windowSwapAnimating && state.windowSwapFromIndex >= 0 && state.windowSwapToIndex >= 0) {
    const fromIdx = state.windowSwapFromIndex
    const toIdx = state.windowSwapToIndex
    if (fromIdx < windowBoxes.length && toIdx < windowBoxes.length) {
      // Calculate animation progress with ease-out
      const rawProgress = state.windowSwapFrame / WINDOW_SWAP_FRAMES
      const progress = easeOut(rawProgress)

      // Box width = inner + 2 borders
      const boxWidth = WINDOW_BOX_WIDTH + 2  // 19 chars
      const gap = 1  // Gap between boxes

      // Swap zone width = two boxes + gap between them
      const zoneWidth = boxWidth + gap + boxWidth  // 39 chars

      // Get the boxes (ensure left box comes first)
      const leftIdx = Math.min(fromIdx, toIdx)
      const rightIdx = Math.max(fromIdx, toIdx)
      const leftBox = windowBoxes[leftIdx]
      const rightBox = windowBoxes[rightIdx]

      // Determine which box is moving right (the "from" box)
      const leftIsMovingRight = fromIdx === leftIdx

      // Calculate positions within the zone
      // At progress 0: left box at position 0, right box at position (boxWidth + gap)
      // At progress 1: boxes have swapped - left box at (boxWidth + gap), right box at 0
      const leftStart = 0
      const leftEnd = zoneWidth - boxWidth
      const rightStart = zoneWidth - boxWidth
      const rightEnd = 0

      let leftPos: number
      let rightPos: number

      if (leftIsMovingRight) {
        // Left box (from) moves right, right box (to) moves left
        leftPos = Math.round(leftStart + progress * (leftEnd - leftStart))
        rightPos = Math.round(rightStart + progress * (rightEnd - rightStart))
      } else {
        // Right box (from) moves left, left box (to) moves right
        rightPos = Math.round(rightStart + progress * (rightEnd - rightStart))
        leftPos = Math.round(leftStart + progress * (leftEnd - leftStart))
      }

      // Render the swap zone (stripAnsi imported from utils.ts)
      swapZoneRows = leftBox.map((row1, rowIdx) => {
        const row2 = rightBox[rowIdx]

        // Strip ANSI codes to get pure visual characters for buffer manipulation
        const pureRow1 = stripAnsi(row1)
        const pureRow2 = stripAnsi(row2)

        // Create a zone buffer filled with spaces
        const buffer: string[] = new Array(zoneWidth).fill(' ')

        // Place right box first (background if overlapping)
        const chars2 = [...pureRow2]
        for (let i = 0; i < chars2.length && rightPos + i < zoneWidth; i++) {
          if (rightPos + i >= 0) {
            buffer[rightPos + i] = chars2[i]
          }
        }

        // Place left box second (foreground if overlapping - this is the selected box)
        const chars1 = [...pureRow1]
        for (let i = 0; i < chars1.length && leftPos + i < zoneWidth; i++) {
          if (leftPos + i >= 0) {
            buffer[leftPos + i] = chars1[i]
          }
        }

        // Re-apply styling: selected box (left) gets white color
        // The result has the left (selected) box overlaid on the right box
        return ansi.white + buffer.join('') + ansi.reset
      }) as [string, string, string, string]

      swapZoneFromIdx = leftIdx
      swapZoneToIdx = rightIdx
    }
  }

  // Add window boxes to row parts
  // If swap animation is active, replace the two swapping boxes with the swap zone
  for (let i = 0; i < windowBoxes.length; i++) {
    if (swapZoneRows && i === swapZoneFromIdx) {
      // Add the swap zone in place of the first swapping box
      row0Parts.push(swapZoneRows[0])
      row1Parts.push(swapZoneRows[1])
      row2Parts.push(swapZoneRows[2])
      row3Parts.push(swapZoneRows[3])
    } else if (swapZoneRows && i === swapZoneToIdx) {
      // Skip the second swapping box (it's included in the swap zone)
      continue
    } else {
      // Normal box
      const [t, m1, m2, b] = windowBoxes[i]
      row0Parts.push(t)
      row1Parts.push(m1)
      row2Parts.push(m2)
      row3Parts.push(b)
    }
  }

  // [+] button (two lines: "+" on first line, empty second line)
  const isPlusSelected = windowFocused && state.carouselIndex === maxIndex
  const [plusT, plusM1, plusM2, plusB] = buildBox([" + ", ""], BUTTON_BOX_WIDTH, isPlusSelected, !isPlusSelected)
  row0Parts.push(plusT)
  row1Parts.push(plusM1)
  row2Parts.push(plusM2)
  row3Parts.push(plusB)

  // Join with spaces between boxes
  const carouselRow0 = row0Parts.join(" ")
  const carouselRow1 = row1Parts.join(" ")
  const carouselRow2 = row2Parts.join(" ")
  const carouselRow3 = row3Parts.join(" ")

  // Draw the 6-row carousel box with gray outline (2 content lines per box)
  // Use width - 4 so the total rendered width (inner + 2 corners) fits with margin
  const carouselBoxWidth = width - 4
  const carouselStartX = 1

  // Row 0: Top border of outer box
  out += ansi.moveTo(carouselStartX, 0)
  out += ansi.dim + box.tl + box.h.repeat(carouselBoxWidth) + box.tr + ansi.reset

  // Row 1: Top borders of inner boxes (with outer side borders)
  out += ansi.moveTo(carouselStartX, 1)
  out += ansi.dim + box.v + ansi.reset + " " + carouselRow0
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 1)
  out += ansi.dim + box.v + ansi.reset

  // Row 2: Content line 1 of inner boxes (with outer side borders)
  out += ansi.moveTo(carouselStartX, 2)
  out += ansi.dim + box.v + ansi.reset + " " + carouselRow1
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 2)
  out += ansi.dim + box.v + ansi.reset

  // Row 3: Content line 2 of inner boxes (with outer side borders)
  out += ansi.moveTo(carouselStartX, 3)
  out += ansi.dim + box.v + ansi.reset + " " + carouselRow2
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 3)
  out += ansi.dim + box.v + ansi.reset

  // Row 4: Bottom borders of inner boxes (with outer side borders)
  out += ansi.moveTo(carouselStartX, 4)
  out += ansi.dim + box.v + ansi.reset + " " + carouselRow3
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 4)
  out += ansi.dim + box.v + ansi.reset

  // Row 5: Bottom border of outer box
  out += ansi.moveTo(carouselStartX, 5)
  out += ansi.dim + box.bl + box.h.repeat(carouselBoxWidth) + box.br + ansi.reset

  // Separator (moved down to row 6)
  out += ansi.moveTo(0, 6) + box.h.repeat(width)

  // Layout preview (center area, below carousel box)
  const layout = ALL_LAYOUTS[state.layoutIndex]
  const previewW = Math.min(width - 4, 40)
  const previewH = Math.min(height - 11, 12)  // Adjusted for taller 6-row carousel
  const previewX = Math.floor((width - previewW) / 2)
  const previewY = 8  // Start after carousel (6 rows) + separator (1 row) + gap (1 row)
  out += drawLayoutPreview(layout, previewX, previewY, previewW, previewH)

  // Layout name and counter
  const paneCount = layout.panes.length
  const layoutFocused = state.focus === "layout"
  const counter = `${paneCount} pane${paneCount > 1 ? 's' : ''} · ${state.layoutIndex + 1}/${ALL_LAYOUTS.length}`
  out += ansi.moveTo(Math.floor((width - counter.length - 2) / 2), previewY + previewH)
  if (layoutFocused) out += ansi.inverse
  out += ` ${counter} `
  out += ansi.reset

  // Separator
  out += ansi.moveTo(0, height - 2) + box.h.repeat(width)

  // Key hints (bottom row)
  const hints = state.mode === "dirPicker"
    ? "type to filter  jk nav  ⏎ select  esc cancel"
    : "tab focus  hjkl nav  ⏎ apply"
  out += ansi.moveTo(1, height - 1) + ansi.dim + hints + ansi.reset

  // Directory picker overlay (if active)
  if (state.mode === "dirPicker" && state.dirPicker) {
    out += renderDirPicker(state.dirPicker, width, height)
  }

  process.stdout.write(out)
}


// ── Startup window rename ───────────────────────────────────────────────────

/**
 * Rename all windows on startup using 15-char heuristic.
 * Runs async so it doesn't block the initial UI render.
 */
async function renameWindowsOnStartup(): Promise<void> {
  try {
    const { renameAllWindows } = await import("./window-naming")
    const count = await renameAllWindows()
    log(`[cmux] Startup renamed ${count} window(s)`)

    // Refresh window list to show updated names
    state.windows = getWindows()
    render()
  } catch (e) {
    log('[cmux] Startup rename failed:', e)
  }
}

// ── Input handling ─────────────────────────────────────────────────────────
function handleKey(key: string): boolean {
  if (state.mode === "dirPicker") {
    return handleDirPickerMode(key)
  }
  return handleMainKey(key)
}

function handleDirPickerMode(key: string): boolean {
  if (!state.dirPicker) {
    state.mode = "main"
    return true
  }

  const result = handleDirPickerKey(state.dirPicker, key)

  switch (result.action) {
    case "continue":
      state.dirPicker = result.state
      break
    case "cancel":
      state.mode = "main"
      state.dirPicker = null
      break
    case "select":
      createNewWindowAtPath(result.path)
      return false // Exit UI after creating window
  }

  return true
}

function handleMainKey(key: string): boolean {
  // Convert arrow keys to hjkl in main mode
  // This is done here (not in runUI) so dirPicker mode gets raw escape sequences
  let normalizedKey = key
  if (key === "\x1b[A") normalizedKey = "k"      // Up arrow
  else if (key === "\x1b[B") normalizedKey = "j" // Down arrow
  else if (key === "\x1b[C") normalizedKey = "l" // Right arrow
  else if (key === "\x1b[D") normalizedKey = "h" // Left arrow

  // During animation, ignore navigation keys but allow other actions
  if (state.animating && (normalizedKey === "h" || normalizedKey === "j" || normalizedKey === "k" || normalizedKey === "l")) {
    if (state.focus === "layout") {
      return true // Ignore layout nav during animation, but don't quit
    }
  }

  // During window swap animation, ignore window navigation
  if (state.windowSwapAnimating && (normalizedKey === "h" || normalizedKey === "l" || normalizedKey === "\x1bh" || normalizedKey === "\x1bl")) {
    return true // Ignore window nav during swap animation
  }

  const maxCarouselIndex = state.windows.length + 1  // 0=minus, 1..n=windows, n+1=plus

  switch (normalizedKey) {
    case "\t": // Tab - switch focus
      state.focus = state.focus === "window" ? "layout" : "window"
      state.confirmingDelete = false // Cancel confirmation when switching focus
      break
    case "j": // Down - move focus to layout
      if (state.focus === "window") {
        state.focus = "layout"
        state.confirmingDelete = false
      }
      // When already on layout, j does nothing (no UI element below)
      break
    case "k": // Up - move focus to window bar
      if (state.focus === "layout") {
        state.focus = "window"
      }
      // When already on window bar, k does nothing (no UI element above)
      break
    case "h":
      if (state.focus === "window") {
        // Move carousel left (clamp at 0)
        if (state.carouselIndex > 0) {
          state.carouselIndex--
          state.confirmingDelete = false // Cancel confirmation when navigating
        }
      } else {
        state.previousLayoutIndex = state.layoutIndex
        state.layoutIndex = (state.layoutIndex - 1 + ALL_LAYOUTS.length) % ALL_LAYOUTS.length
        startAnimation("left")
        return true // Don't call render(), animation handles it
      }
      break
    case "l":
      if (state.focus === "window") {
        // Move carousel right (clamp at max)
        if (state.carouselIndex < maxCarouselIndex) {
          state.carouselIndex++
          state.confirmingDelete = false // Cancel confirmation when navigating
        }
      } else {
        state.previousLayoutIndex = state.layoutIndex
        state.layoutIndex = (state.layoutIndex + 1) % ALL_LAYOUTS.length
        startAnimation("right")
        return true // Don't call render(), animation handles it
      }
      break
    case " ":
    case "\r": // Enter
      // If delete confirmation is showing, Enter confirms the deletion
      if (state.confirmingDelete) {
        removeCurrentWindow()
        return false // Exit UI after deletion
      }

      if (state.focus === "window") {
        if (state.carouselIndex === 0) {
          // Minus button - show delete confirmation (inline in current window)
          if (state.windows.length > 1) {
            state.confirmingDelete = true
          }
        } else if (state.carouselIndex === maxCarouselIndex) {
          // Plus button - open directory picker
          openDirPicker()
        } else {
          // Window selected - switch to that window and exit
          const windowIndex = state.carouselIndex - 1
          const selectedWindow = state.windows[windowIndex]
          if (selectedWindow && windowIndex !== state.currentWindowIndex) {
            try {
              execSync(`tmux select-window -t :${selectedWindow.index}`)
            } catch {
              // Ignore errors
            }
            return false // Exit UI after switching window
          }
        }
      } else {
        applyAndExit()
        return false
      }
      break
    case "\x1b": // Escape
      if (state.confirmingDelete) {
        state.confirmingDelete = false // cancel delete confirmation
      } else {
        return false
      }
      break
    case "q":
      return false
    case "-":
      // Minus key - trigger delete confirmation (shows inline in current window)
      if (state.confirmingDelete) {
        // Second press - actually delete and exit
        removeCurrentWindow()
        return false
      } else {
        // First press - show confirmation inline in current window (if more than one window)
        if (state.windows.length > 1) {
          state.focus = "window"
          state.confirmingDelete = true
        }
      }
      break
    case "+":
    case "=":  // Support both + and = (unshifted +) for convenience
      // Plus key - open directory picker (same as pressing Enter on plus button)
      openDirPicker()
      break
    case "1":
    case "2":
    case "3":
    case "4":
    case "5":
    case "6":
    case "7":
    case "8":
    case "9":
      // Number keys select windows (1-indexed to match superscript display)
      const windowIndex = parseInt(normalizedKey) - 1
      if (windowIndex < state.windows.length) {
        const selectedWindow = state.windows[windowIndex]
        try {
          execSync(`tmux select-window -t :${selectedWindow.index}`)
        } catch {
          // Ignore errors
        }
        return false // Exit UI after switching window
      }
      break
    case "\x1bh": // Alt+h - move window left
      if (state.focus === "window" && !state.windowSwapAnimating) {
        // Only works when on an actual window (carouselIndex 1 to windows.length)
        const currentIdx = state.carouselIndex - 1  // Convert to window array index
        if (currentIdx > 0 && currentIdx < state.windows.length) {
          // Can move left - start animation
          startWindowSwapAnimation(currentIdx, currentIdx - 1, "left")
          return true // Animation handles render
        }
      }
      break
    case "\x1bl": // Alt+l - move window right
      if (state.focus === "window" && !state.windowSwapAnimating) {
        // Only works when on an actual window (carouselIndex 1 to windows.length)
        const currentIdx = state.carouselIndex - 1  // Convert to window array index
        if (currentIdx >= 0 && currentIdx < state.windows.length - 1) {
          // Can move right - start animation
          startWindowSwapAnimation(currentIdx, currentIdx + 1, "right")
          return true // Animation handles render
        }
      }
      break
  }
  return true
}

function openDirPicker(): void {
  try {
    const currentPath = execSync("tmux display-message -p '#{pane_current_path}'").toString().trim()
    if (currentPath) {
      state.dirPicker = initDirPickerState(currentPath)
      state.mode = "dirPicker"
    } else {
      // Fallback: create window in current dir if we can't get path
      createNewWindow()
    }
  } catch {
    // Fallback if tmux command fails
    createNewWindow()
  }
}

function createNewWindowAtPath(targetPath: string): void {
  try {
    const pathArg = `-c "${targetPath}"`

    // Create the new window at the target path
    execSync(`tmux new-window ${pathArg}`)

    const layout = ALL_LAYOUTS[state.layoutIndex]
    const paneCount = layout.panes.length

    // New window starts with 1 pane, add more if needed
    for (let i = 1; i < paneCount; i++) {
      execSync(`tmux split-window ${pathArg}`)
    }

    // Get updated window info for layout application
    const windowInfo = getWindowInfo()

    // Resolve layout to absolute coords
    const resolved = resolveLayout(layout, windowInfo.width, windowInfo.height)

    // Generate tmux layout string
    const panes = resolved.map((r, i) => ({
      id: windowInfo.panes[i]?.id || `%${i}`,
      ...r,
    }))
    const layoutString = generateLayoutString(panes, windowInfo.width, windowInfo.height)

    // Apply the layout
    execSync(`tmux select-layout '${layoutString}'`)
  } catch (e) {
    // Ignore errors (e.g., not in tmux)
  }
}

function createNewWindow(): void {
  try {
    // Get current pane's working directory before creating new window
    const currentPath = execSync("tmux display-message -p '#{pane_current_path}'").toString().trim()
    const pathArg = currentPath ? `-c "${currentPath}"` : ""

    // Create the new window and switch to it (preserving working directory)
    execSync(`tmux new-window ${pathArg}`)

    const layout = ALL_LAYOUTS[state.layoutIndex]
    const paneCount = layout.panes.length

    // New window starts with 1 pane, add more if needed (preserving working directory)
    for (let i = 1; i < paneCount; i++) {
      execSync(`tmux split-window ${pathArg}`)
    }

    // Get updated window info for layout application
    const windowInfo = getWindowInfo()

    // Resolve layout to absolute coords
    const resolved = resolveLayout(layout, windowInfo.width, windowInfo.height)

    // Generate tmux layout string
    const panes = resolved.map((r, i) => ({
      id: windowInfo.panes[i]?.id || `%${i}`,
      ...r,
    }))
    const layoutString = generateLayoutString(panes, windowInfo.width, windowInfo.height)

    // Apply the layout
    execSync(`tmux select-layout '${layoutString}'`)
  } catch (e) {
    // Ignore errors (e.g., not in tmux)
  }
}

function removeCurrentWindow(): void {
  if (state.windows.length <= 1) return // Don't remove last window
  try {
    const windowToDelete = state.windows[state.currentWindowIndex]
    execSync(`tmux kill-window -t :${windowToDelete.index}`)
    // Renumber windows to eliminate gaps after deletion
    renumberWindows()
  } catch (e) {
    // Ignore errors
  }
}

function applyAndExit(): void {
  const layout = ALL_LAYOUTS[state.layoutIndex]
  const targetWindow = state.windows[state.currentWindowIndex]

  try {
    // Get current pane's working directory for new splits
    const currentPath = execSync("tmux display-message -p '#{pane_current_path}'").toString().trim()
    const pathArg = currentPath ? `-c "${currentPath}"` : ""

    // Switch to target window if different
    if (!targetWindow.active) {
      execSync(`tmux select-window -t :${targetWindow.index}`)
    }

    // 1. Get current window info
    const windowInfo = getWindowInfo()
    const currentPanes: Pane[] = windowInfo.panes.map(p => ({
      id: p.id,
      x: p.left,
      y: p.top,
      width: p.width,
      height: p.height,
    }))

    // 2. Resolve target layout to absolute coordinates
    const resolved = resolveLayout(layout, windowInfo.width, windowInfo.height)
    const slots: Slot[] = resolved.map(r => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    }))

    // 3. Match panes to slots by position
    const { matches, unmatchedSlots, unmatchedPanes } = matchPanesToSlots(currentPanes, slots)

    // 4. Create new panes for unmatched slots (need more panes)
    for (const _slotIndex of unmatchedSlots) {
      execSync(`tmux split-window ${pathArg}`)
    }

    // 5. Compute and execute swap sequence to reorder panes
    // Re-fetch pane info after creates to get the new pane order
    const afterCreates = getWindowInfo()
    const currentOrder = afterCreates.panes.map(p => p.id)

    // Build desired order: for each slot (in order), which pane should be there?
    // matched panes go to their matched slots, new panes fill unmatched slots
    const desiredOrder: string[] = new Array(slots.length)

    // Place matched panes
    for (const match of matches) {
      desiredOrder[match.slotIndex] = match.paneId
    }

    // Identify newly created panes (IDs not in original matches)
    const matchedPaneIds = new Set(matches.map(m => m.paneId))
    const newPaneIds = currentOrder.filter(id => !matchedPaneIds.has(id) && !unmatchedPanes.includes(id))

    // Place new panes into unmatched slots
    for (let i = 0; i < unmatchedSlots.length; i++) {
      const slotIndex = unmatchedSlots[i]
      const newPaneId = newPaneIds[i]
      if (newPaneId) {
        desiredOrder[slotIndex] = newPaneId
      }
    }

    // Filter out undefined slots and panes that will be killed
    const filteredCurrentOrder = currentOrder.filter(id => !unmatchedPanes.includes(id))
    const filteredDesiredOrder = desiredOrder.filter(id => id !== undefined)

    // Execute swaps if needed
    if (filteredCurrentOrder.length === filteredDesiredOrder.length && filteredCurrentOrder.length > 0) {
      const swaps = computeSwaps(filteredCurrentOrder, filteredDesiredOrder)
      if (swaps.length > 0) {
        executeSwaps(`:${targetWindow.index}`, swaps)
      }
    }

    // 6. Kill unmatched panes AFTER swaps (excess panes)
    for (const paneId of unmatchedPanes) {
      execSync(`tmux kill-pane -t '${paneId}'`)
    }

    // 7. Re-fetch pane info and apply final layout geometry
    const finalInfo = getWindowInfo()
    const finalResolved = resolveLayout(layout, finalInfo.width, finalInfo.height)

    // Generate tmux layout string
    const finalPanes = finalResolved.map((r, i) => ({
      id: finalInfo.panes[i]?.id || `%${i}`,
      ...r,
    }))
    const layoutString = generateLayoutString(finalPanes, finalInfo.width, finalInfo.height)

    // Apply the layout
    execSync(`tmux select-layout '${layoutString}'`)
  } catch (e) {
    // Not in tmux or error - just exit silently
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
function isInsideTmux(): boolean {
  return !!process.env.TMUX
}

function startTmuxSession(): void {
  const apiKey = process.env.ANTHROPIC_API_KEY
    || process.env.TEST_ANTHROPIC_API_KEY
    || process.env.DEMO_ANTHROPIC_API_KEY;

  const tmuxArgs = [
    "-f", CONFIG_PATH,
    "new-session",
    ";",
    "bind", "-n", "M-Space", "display-popup", "-w", "80%", "-h", "80%", "-E", `bun ${SELF_PATH}`
  ];

  // Save API key to tmux hidden environment for popup runs
  if (apiKey) {
    tmuxArgs.push(";", "set-environment", "-gh", "ANTHROPIC_API_KEY", apiKey);
  }

  const tmux = spawn("tmux", tmuxArgs, {
    stdio: "inherit",
  })

  tmux.on("close", (code) => {
    process.exit(code ?? 0)
  })
}

function runUI(): void {
  if (!process.stdin.isTTY) {
    console.error("Not a TTY")
    process.exit(1)
  }

  // Switch to alt-screen immediately for instant visual feedback
  process.stdout.write(ansi.altScreen + ansi.hideCursor)
  process.stdin.setRawMode(true)
  process.stdin.resume()

  // Initialize state after alt-screen switch (includes tmux queries)
  state = initState()

  initLog()
  log('[cmux] runUI starting')

  render()

  // Benchmark mode: exit immediately after first render
  if (BENCHMARK_MODE) {
    cleanup()
    return
  }

  startPolling()

  // Rename windows immediately on startup (async, doesn't block UI)
  renameWindowsOnStartup()

  process.stdin.on("data", (data) => {
    const input = data.toString()

    // Parse input into key sequences
    // Arrow keys send: \x1b[A (up), \x1b[B (down), \x1b[C (right), \x1b[D (left)
    // Skip translation in dirPicker mode - it expects raw escape sequences
    let i = 0
    while (i < input.length) {
      let key: string

      // Check for escape sequences
      if (input[i] === "\x1b" && i + 1 < input.length) {
        if (input[i + 1] === "[") {
          // Arrow key sequences: ESC [ A/B/C/D
          const arrowChar = input[i + 2]
          if (arrowChar === "A" || arrowChar === "B" || arrowChar === "C" || arrowChar === "D") {
            // Pass arrow key escape sequence through as-is
            // handleMainKey() will convert to hjkl for main mode
            // handleDirPickerKey() expects raw sequences for dirPicker mode
            key = input.slice(i, i + 3)
            i += 3
          } else {
            // Unknown escape sequence, treat as regular escape
            key = input[i]
            i++
          }
        } else if (input[i + 1] !== "[") {
          // Alt+key sequences: ESC followed by letter (no bracket)
          // e.g., Alt+h = "\x1bh", Alt+l = "\x1bl"
          key = input.slice(i, i + 2)
          i += 2
        } else {
          key = input[i]
          i++
        }
      } else {
        key = input[i]
        i++
      }

      if (!handleKey(key)) {
        cleanup()
        return
      }
    }
    render()
  })
}

function main(): void {
  if (!isInsideTmux()) {
    startTmuxSession()
    return
  }
  runUI()
}

function cleanup() {
  stopPolling()
  process.stdout.write(ansi.showCursor + ansi.exitAltScreen)
  process.stdin.setRawMode(false)
  process.exit(0)
}

process.on("SIGINT", cleanup)
process.on("SIGTERM", cleanup)

main()
