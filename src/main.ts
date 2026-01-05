import { execSync, spawn } from "node:child_process"
import { join } from "node:path"
import { ALL_LAYOUTS, resolveLayout, type LayoutTemplate } from "./layouts"
import { renderLayoutPreview } from "./layout-preview"
import { getWindows, getWindowInfo, getWindowContext, type TmuxWindow } from "./tmux"
import { generateLayoutString } from "./tmux-layout"
import { getSummariesForWindows } from "./summaries"
import { initLog, log } from "./logger"
import { sanitizeWindowName } from "./utils"

const CONFIG_PATH = join(import.meta.dir, "../config/tmux.conf")
const SELF_PATH = import.meta.path
const BACKGROUND_RENAMER_PATH = join(import.meta.dir, "background-renamer.ts")

// ── State ──────────────────────────────────────────────────────────────────
type Focus = "window" | "layout"
type AnimationDirection = "left" | "right" | null

interface State {
  windows: TmuxWindow[]
  currentWindowIndex: number
  layoutIndex: number
  carouselIndex: number  // 0 = minus, 1..n = windows, n+1 = plus
  focus: Focus
  // Animation state
  animating: boolean
  animationDirection: AnimationDirection
  animationFrame: number
  previousLayoutIndex: number
  // Summary state
  summaries: Map<number, string>  // windowIndex -> summary
  summariesLoading: boolean
  // Delete confirmation state
  confirmingDelete: boolean
}

function initState(): State {
  let windows: TmuxWindow[] = []
  let currentWindowIndex = 0
  let layoutIndex = 0
  let currentPaneCount = 1

  try {
    windows = getWindows()
    currentWindowIndex = windows.findIndex(w => w.active)
    if (currentWindowIndex < 0) currentWindowIndex = 0

    // Get current pane count
    const windowInfo = getWindowInfo()
    currentPaneCount = windowInfo.panes.length

    // Find first layout with matching pane count
    layoutIndex = ALL_LAYOUTS.findIndex(l => l.panes.length === currentPaneCount)
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
    focus: "window" as Focus,
    // Animation state
    animating: false,
    animationDirection: null,
    animationFrame: 0,
    previousLayoutIndex: layoutIndex,
    // Summary state
    summaries: new Map(),
    summariesLoading: false,
    // Delete confirmation state
    confirmingDelete: false,
  }
}

const state = initState()

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
}

// Box drawing
const box = {
  tl: "┌", tr: "┐", bl: "└", br: "┘",
  h: "─", v: "│",
  ltee: "├", rtee: "┤", ttee: "┬", btee: "┴",
  cross: "┼",
  // Double-line variants for selection
  dtl: "╔", dtr: "╗", dbl: "╚", dbr: "╝",
  dh: "═", dv: "║",
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
  const previewH = Math.min(height - 10, 12)  // Adjusted for taller carousel
  const previewX = Math.floor((width - previewW) / 2)
  const previewY = 7  // Start after carousel (5 rows) + separator (1 row) + gap (1 row)

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

// ── Main render ────────────────────────────────────────────────────────────
function render(): void {
  const width = process.stdout.columns || 80
  const height = process.stdout.rows || 24

  let out = ansi.clear

  // Window carousel (5 rows tall with gray box outline)
  const windowFocused = state.focus === "window"
  const maxIndex = state.windows.length + 1  // 0=minus, 1..n=windows, n+1=plus

  // Helper to truncate window names to 15 chars
  const truncateName = (name: string): string => {
    if (name.length <= 15) return name
    return name.slice(0, 14) + "…"
  }

  // Build the 3-row carousel content (each window/button is a bordered box)
  const WINDOW_BOX_WIDTH = 17  // Inner width for window names (15 chars + 2 for padding/indicator)
  const BUTTON_BOX_WIDTH = 3   // Inner width for +/- buttons

  // Build arrays for each row of the carousel content
  let row0Parts: string[] = []  // Top borders
  let row1Parts: string[] = []  // Content (middle)
  let row2Parts: string[] = []  // Bottom borders

  // Helper to build a box element (returns 3 rows)
  // Selected items use double-line borders (bright/white), non-selected use single-line (dim/gray)
  // windowNumber is optional 1-indexed number to show as superscript in top-right corner
  const buildBox = (content: string, innerWidth: number, isSelected: boolean, isDim: boolean = false, windowNumber?: number): [string, string, string] => {
    // Choose border characters based on selection state
    const tl = isSelected ? box.dtl : box.tl
    const tr = isSelected ? box.dtr : box.tr
    const bl = isSelected ? box.dbl : box.bl
    const br = isSelected ? box.dbr : box.br
    const h = isSelected ? box.dh : box.h
    const v = isSelected ? box.dv : box.v

    let topBorder: string
    if (windowNumber !== undefined && windowNumber >= 0 && windowNumber <= 9) {
      // Add superscript number at end of top border, with one extra horizontal char to compensate for narrow superscript
      topBorder = tl + h.repeat(innerWidth + 1) + superscript[windowNumber] + tr
    } else {
      topBorder = tl + h.repeat(innerWidth) + tr
    }
    const bottomBorder = bl + h.repeat(innerWidth) + br

    // Center content within innerWidth
    let paddedContent: string
    if (content.length < innerWidth) {
      const totalPadding = innerWidth - content.length
      const leftPad = Math.floor(totalPadding / 2)
      const rightPad = totalPadding - leftPad
      paddedContent = " ".repeat(leftPad) + content + " ".repeat(rightPad)
    } else {
      paddedContent = content.slice(0, innerWidth)
    }
    const middleRow = v + paddedContent + v

    if (isSelected) {
      // Selected: bright white double-line borders
      return [
        ansi.white + topBorder + ansi.reset,
        ansi.white + middleRow + ansi.reset,
        ansi.white + bottomBorder + ansi.reset
      ]
    } else if (isDim) {
      // Dim: gray single-line borders
      return [
        ansi.dim + topBorder + ansi.reset,
        ansi.dim + middleRow + ansi.reset,
        ansi.dim + bottomBorder + ansi.reset
      ]
    }
    // Default: normal single-line borders
    return [topBorder, middleRow, bottomBorder]
  }

  // [−] button (shows "Delete? ⏎" when confirming)
  if (state.confirmingDelete) {
    const confirmWidth = 10  // "Delete? ⏎"
    const [t, m, b] = buildBox("Delete? ⏎", confirmWidth, true)
    row0Parts.push(t)
    row1Parts.push(m)
    row2Parts.push(b)
  } else {
    const isMinusSelected = windowFocused && state.carouselIndex === 0
    const [t, m, b] = buildBox(" − ", BUTTON_BOX_WIDTH, isMinusSelected)
    row0Parts.push(t)
    row1Parts.push(m)
    row2Parts.push(b)
  }

  // Window items
  for (let i = 0; i < state.windows.length; i++) {
    const win = state.windows[i]
    const isSelected = windowFocused && state.carouselIndex === i + 1
    const isCurrent = i === state.currentWindowIndex

    let content = truncateName(win.name)
    if (isCurrent) content += " ●"

    // Pass window index for superscript number (0-9 only)
    const windowNum = win.index <= 9 ? win.index : undefined
    const [t, m, b] = buildBox(content, WINDOW_BOX_WIDTH, isSelected, false, windowNum)
    row0Parts.push(t)
    row1Parts.push(m)
    row2Parts.push(b)
  }

  // [+] button
  const isPlusSelected = windowFocused && state.carouselIndex === maxIndex
  const [plusT, plusM, plusB] = buildBox(" + ", BUTTON_BOX_WIDTH, isPlusSelected, !isPlusSelected)
  row0Parts.push(plusT)
  row1Parts.push(plusM)
  row2Parts.push(plusB)

  // Join with spaces between boxes
  const carouselRow0 = row0Parts.join(" ")
  const carouselRow1 = row1Parts.join(" ")
  const carouselRow2 = row2Parts.join(" ")

  // Draw the 5-row carousel box with gray outline
  const carouselBoxWidth = width - 2
  const carouselStartX = 1

  // Row 0: Top border of outer box
  out += ansi.moveTo(carouselStartX, 0)
  out += ansi.dim + box.tl + box.h.repeat(carouselBoxWidth) + box.tr + ansi.reset

  // Row 1: Top borders of inner boxes (with outer side borders)
  out += ansi.moveTo(carouselStartX, 1)
  out += ansi.dim + box.v + ansi.reset + " " + carouselRow0
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 1)
  out += ansi.dim + box.v + ansi.reset

  // Row 2: Content row of inner boxes (with outer side borders)
  out += ansi.moveTo(carouselStartX, 2)
  out += ansi.dim + box.v + ansi.reset + " " + carouselRow1
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 2)
  out += ansi.dim + box.v + ansi.reset

  // Row 3: Bottom borders of inner boxes (with outer side borders)
  out += ansi.moveTo(carouselStartX, 3)
  out += ansi.dim + box.v + ansi.reset + " " + carouselRow2
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 3)
  out += ansi.dim + box.v + ansi.reset

  // Row 4: Bottom border of outer box
  out += ansi.moveTo(carouselStartX, 4)
  out += ansi.dim + box.bl + box.h.repeat(carouselBoxWidth) + box.br + ansi.reset

  // Separator (moved down to row 5)
  out += ansi.moveTo(0, 5) + box.h.repeat(width)

  // Layout preview (center area, below carousel box)
  const layout = ALL_LAYOUTS[state.layoutIndex]
  const previewW = Math.min(width - 4, 40)
  const previewH = Math.min(height - 10, 12)  // Adjusted for taller carousel
  const previewX = Math.floor((width - previewW) / 2)
  const previewY = 7  // Start after carousel (5 rows) + separator (1 row) + gap (1 row)
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
  const hints = "tab focus  hjkl nav  ⏎ apply"
  out += ansi.moveTo(1, height - 1) + ansi.dim + hints + ansi.reset

  process.stdout.write(out)
}


// ── Summary fetching ────────────────────────────────────────────────────────

// Rename tmux windows with AI-generated summaries
async function renameWindowsWithSummaries(summaries: Map<number, string>): Promise<void> {
  log('[cmux] renameWindowsWithSummaries called, entries:', Array.from(summaries.entries()));
  for (const [windowIndex, summary] of summaries) {
    const shortName = sanitizeWindowName(summary)
    if (shortName.length > 0) {
      try {
        log(`[cmux] renaming window ${windowIndex} to "${shortName}"`);
        execSync(`tmux rename-window -t :${windowIndex} "${shortName}"`)
      } catch (e) {
        log(`[cmux] rename failed for window ${windowIndex}:`, e);
      }
    }
  }
}

async function fetchSummaries(): Promise<void> {
  if (state.summariesLoading) return

  log('[cmux] fetchSummaries called, windows:', state.windows.map(w => w.index));

  state.summariesLoading = true
  render()

  try {
    // Get contexts for all windows in parallel
    const contexts = await Promise.all(
      state.windows.map(w => getWindowContext(w.index))
    )

    log('[cmux] contexts:', JSON.stringify(contexts, null, 2));

    // Get summaries for all contexts
    const summaries = await getSummariesForWindows(contexts)

    state.summaries = summaries

    log('[cmux] summaries:', Array.from(state.summaries.entries()));

    // Rename tmux windows with the fetched summaries
    await renameWindowsWithSummaries(summaries)
  } catch {
    // Silently fail - summaries will just show "..."
  } finally {
    state.summariesLoading = false
    render()
  }
}

// ── Input handling ─────────────────────────────────────────────────────────
function handleKey(key: string): boolean {
  return handleMainKey(key)
}

function handleMainKey(key: string): boolean {
  // During animation, ignore layout navigation keys but allow other actions
  if (state.animating && (key === "h" || key === "j" || key === "k" || key === "l")) {
    if (state.focus === "layout") {
      return true // Ignore layout nav during animation, but don't quit
    }
  }

  const maxCarouselIndex = state.windows.length + 1  // 0=minus, 1..n=windows, n+1=plus

  switch (key) {
    case "\t": // Tab - switch focus
      state.focus = state.focus === "window" ? "layout" : "window"
      state.confirmingDelete = false // Cancel confirmation when switching focus
      break
    case "j": // Down - move focus to layout
      if (state.focus === "window") {
        state.focus = "layout"
        state.confirmingDelete = false
      } else {
        state.previousLayoutIndex = state.layoutIndex
        state.layoutIndex = (state.layoutIndex + 1) % ALL_LAYOUTS.length
        startAnimation("right")
        return true // Don't call render(), animation handles it
      }
      break
    case "k": // Up - move focus to window bar
      if (state.focus === "layout") {
        state.previousLayoutIndex = state.layoutIndex
        state.layoutIndex = (state.layoutIndex - 1 + ALL_LAYOUTS.length) % ALL_LAYOUTS.length
        startAnimation("left")
        return true // Don't call render(), animation handles it
      }
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
      if (state.focus === "window") {
        if (state.carouselIndex === 0) {
          // Minus button - delete window
          if (state.confirmingDelete) {
            // Second Enter - actually delete and exit
            removeCurrentWindow()
            return false // Exit UI after deletion
          } else {
            // First Enter - show confirmation
            if (state.windows.length > 1) {
              state.confirmingDelete = true
            }
          }
        } else if (state.carouselIndex === maxCarouselIndex) {
          // Plus button - create new window
          createNewWindow()
          return false // Exit UI after creating window with layout
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
  }
  return true
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

    const windowInfo = getWindowInfo()
    const paneCount = layout.panes.length
    const currentPaneCount = windowInfo.panes.length

    // Switch to target window if different
    if (!targetWindow.active) {
      execSync(`tmux select-window -t :${targetWindow.index}`)
    }

    // Adjust pane count
    if (currentPaneCount < paneCount) {
      // Need more panes - split (preserving working directory)
      for (let i = currentPaneCount; i < paneCount; i++) {
        execSync(`tmux split-window ${pathArg}`)
      }
    } else if (currentPaneCount > paneCount) {
      // Too many panes - kill extras
      for (let i = currentPaneCount; i > paneCount; i--) {
        execSync(`tmux kill-pane`)
      }
    }

    // Re-fetch pane info after adjustments
    const updatedInfo = getWindowInfo()

    // Resolve layout to absolute coords
    const resolved = resolveLayout(layout, updatedInfo.width, updatedInfo.height)

    // Generate tmux layout string
    const panes = resolved.map((r, i) => ({
      id: updatedInfo.panes[i]?.id || `%${i}`,
      ...r,
    }))
    const layoutString = generateLayoutString(panes, updatedInfo.width, updatedInfo.height)

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

  // Start background window renamer (runs detached, outputs to /dev/null)
  // Pass API key inline to avoid persisting it in tmux environment
  if (apiKey) {
    tmuxArgs.push(
      ";",
      "run-shell", "-b", `ANTHROPIC_API_KEY='${apiKey}' bun ${BACKGROUND_RENAMER_PATH} >/dev/null 2>&1`
    );
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
  initLog()
  log('[cmux] runUI starting')
  process.stdout.write(ansi.altScreen + ansi.hideCursor)
  process.stdin.setRawMode(true)
  process.stdin.resume()

  render()
  startPolling()

  process.stdin.on("data", (data) => {
    const input = data.toString()

    // Handle arrow key escape sequences
    // Arrow keys send: \x1b[A (up), \x1b[B (down), \x1b[C (right), \x1b[D (left)
    let i = 0
    while (i < input.length) {
      let key: string

      // Check for escape sequences (arrow keys)
      if (input[i] === "\x1b" && input[i + 1] === "[") {
        const arrowChar = input[i + 2]
        if (arrowChar === "A") {
          key = "k" // Up arrow = k
          i += 3
        } else if (arrowChar === "B") {
          key = "j" // Down arrow = j
          i += 3
        } else if (arrowChar === "C") {
          key = "l" // Right arrow = l
          i += 3
        } else if (arrowChar === "D") {
          key = "h" // Left arrow = h
          i += 3
        } else {
          // Unknown escape sequence, treat as regular escape
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
