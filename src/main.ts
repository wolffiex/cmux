import { execSync, spawn } from "node:child_process"
import { join } from "node:path"
import { ALL_LAYOUTS, resolveLayout, type LayoutTemplate } from "./layouts"
import { renderLayoutPreview } from "./layout-preview"
import { getWindows, getWindowInfo, type TmuxWindow } from "./tmux"
import { generateLayoutString } from "./tmux-layout"

const CONFIG_PATH = join(import.meta.dir, "../config/tmux.conf")
const SELF_PATH = import.meta.path

// ── State ──────────────────────────────────────────────────────────────────
type Focus = "window" | "layout"
type WindowBarSelection = "minus" | "name" | "plus"
type AnimationDirection = "left" | "right" | null

interface State {
  windows: TmuxWindow[]
  currentWindowIndex: number
  layoutIndex: number
  windowPopoverOpen: boolean
  windowPopoverSelection: number  // offset from current window
  focus: Focus
  windowBarSelection: WindowBarSelection
  // Animation state
  animating: boolean
  animationDirection: AnimationDirection
  animationFrame: number
  previousLayoutIndex: number
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
    windowPopoverOpen: false,
    windowPopoverSelection: 0,
    focus: "window" as Focus,
    windowBarSelection: "name" as WindowBarSelection,
    // Animation state
    animating: false,
    animationDirection: null,
    animationFrame: 0,
    previousLayoutIndex: layoutIndex,
  }
}

const state = initState()

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
}

// Box drawing
const box = {
  tl: "┌", tr: "┐", bl: "└", br: "┘",
  h: "─", v: "│",
  ltee: "├", rtee: "┤", ttee: "┬", btee: "┴",
  cross: "┼",
}

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
  const previewH = Math.min(height - 6, 12)
  const previewX = Math.floor((width - previewW) / 2)
  const previewY = 3

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

  // Window bar (top row): [−] name ▼ [+]
  const windowName = state.windows[state.currentWindowIndex]?.name || "?"
  const windowFocused = state.focus === "window"
  const sel = state.windowBarSelection
  out += ansi.moveTo(1, 0)

  // [−] button
  if (windowFocused && sel === "minus") out += ansi.inverse
  out += "[−]"
  out += ansi.reset + " "

  // Window name
  if (windowFocused && sel === "name") out += ansi.inverse
  out += " " + windowName + " ▼ "
  out += ansi.reset + " "

  // [+] button (shows "New window" when selected)
  if (windowFocused && sel === "plus") {
    out += ansi.inverse + "[New window]" + ansi.reset
  } else {
    out += ansi.dim + "[+]" + ansi.reset
  }

  // Separator
  out += ansi.moveTo(0, 1) + box.h.repeat(width)

  // Layout preview (center area)
  const layout = ALL_LAYOUTS[state.layoutIndex]
  const previewW = Math.min(width - 4, 40)
  const previewH = Math.min(height - 6, 12)
  const previewX = Math.floor((width - previewW) / 2)
  const previewY = 3
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

  // Window popover (if open)
  if (state.windowPopoverOpen) {
    out += renderWindowPopover(1, 1, height - 4)
  }

  process.stdout.write(out)
}

function getRotatedWindows(): TmuxWindow[] {
  // Rotate window list so current window is first
  const n = state.windows.length
  if (n === 0) return []
  const idx = state.currentWindowIndex
  return [
    ...state.windows.slice(idx),
    ...state.windows.slice(0, idx)
  ]
}

function renderWindowPopover(x: number, y: number, maxH: number): string {
  let out = ""
  const rotated = getRotatedWindows()
  const h = Math.min(rotated.length, maxH)
  const w = Math.max(...rotated.map(w => w.name.length)) + 6

  // Draw popover box
  out += ansi.moveTo(x, y) + box.tl + box.h.repeat(w - 2) + box.tr
  for (let row = 0; row < h; row++) {
    const win = rotated[row]
    const isCurrent = row === 0
    const isSelected = row === state.windowPopoverSelection
    out += ansi.moveTo(x, y + 1 + row) + box.v
    if (isSelected) out += ansi.inverse
    out += (isCurrent ? " ● " : "   ") + win.name.padEnd(w - 5)
    out += ansi.reset + box.v
  }
  out += ansi.moveTo(x, y + h + 1) + box.bl + box.h.repeat(w - 2) + box.br

  return out
}

// ── Input handling ─────────────────────────────────────────────────────────
function handleKey(key: string): boolean {
  if (state.windowPopoverOpen) {
    return handlePopoverKey(key)
  }
  return handleMainKey(key)
}

function handleMainKey(key: string): boolean {
  // During animation, ignore layout navigation keys but allow other actions
  if (state.animating && (key === "h" || key === "j" || key === "k" || key === "l")) {
    if (state.focus === "layout") {
      return true // Ignore layout nav during animation, but don't quit
    }
  }

  switch (key) {
    case "\t": // Tab - switch focus
      state.focus = state.focus === "window" ? "layout" : "window"
      state.windowBarSelection = "name" // reset to name when switching
      break
    case "j": // Down
      if (state.focus === "window") {
        if (state.windowBarSelection === "name" && state.windows.length > 1) {
          state.windowPopoverOpen = true
          state.windowPopoverSelection = 1 // start on next window
        }
      } else {
        state.previousLayoutIndex = state.layoutIndex
        state.layoutIndex = (state.layoutIndex + 1) % ALL_LAYOUTS.length
        startAnimation("right")
        return true // Don't call render(), animation handles it
      }
      break
    case "k": // Up
      if (state.focus === "window") {
        if (state.windowBarSelection === "name" && state.windows.length > 1) {
          state.windowPopoverOpen = true
          state.windowPopoverSelection = state.windows.length - 1 // start on prev window
        }
      } else {
        state.previousLayoutIndex = state.layoutIndex
        state.layoutIndex = (state.layoutIndex - 1 + ALL_LAYOUTS.length) % ALL_LAYOUTS.length
        startAnimation("left")
        return true // Don't call render(), animation handles it
      }
      break
    case "h":
      if (state.focus === "window") {
        // Move selection left: plus -> name -> minus
        if (state.windowBarSelection === "plus") state.windowBarSelection = "name"
        else if (state.windowBarSelection === "name") state.windowBarSelection = "minus"
      } else {
        state.previousLayoutIndex = state.layoutIndex
        state.layoutIndex = (state.layoutIndex - 1 + ALL_LAYOUTS.length) % ALL_LAYOUTS.length
        startAnimation("left")
        return true // Don't call render(), animation handles it
      }
      break
    case "l":
      if (state.focus === "window") {
        // Move selection right: minus -> name -> plus
        if (state.windowBarSelection === "minus") state.windowBarSelection = "name"
        else if (state.windowBarSelection === "name") state.windowBarSelection = "plus"
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
        if (state.windowBarSelection === "minus") {
          removeCurrentWindow()
          state.windowBarSelection = "name"
        } else if (state.windowBarSelection === "plus") {
          createNewWindow()
          state.windowBarSelection = "name"
        }
        // on "name", enter does nothing (use j/k to open popover)
      } else {
        applyAndExit()
        return false
      }
      break
    case "\x1b": // Escape
      if (state.focus === "window" && state.windowBarSelection !== "name") {
        state.windowBarSelection = "name" // cancel back to name
      } else {
        return false
      }
      break
    case "q":
      return false
  }
  return true
}

function handlePopoverKey(key: string): boolean {
  const n = state.windows.length
  switch (key) {
    case "j": // Down
      state.windowPopoverSelection = (state.windowPopoverSelection + 1) % n
      break
    case "k": // Up
      state.windowPopoverSelection = (state.windowPopoverSelection - 1 + n) % n
      break
    case "\r": // Enter - select window
      if (state.windowPopoverSelection > 0) {
        // Switch to selected window
        const rotated = getRotatedWindows()
        const selected = rotated[state.windowPopoverSelection]
        state.currentWindowIndex = state.windows.findIndex(w => w.index === selected.index)
      }
      state.windowPopoverOpen = false
      break
    case "\x1b": // Escape
      state.windowPopoverOpen = false
      break
  }
  return true
}

function createNewWindow(): void {
  try {
    execSync("tmux new-window -d")  // -d = don't switch to it
    // Refresh window list
    state.windows = getWindows()
    // Stay on current window (don't change currentWindowIndex)
  } catch (e) {
    // Ignore errors
  }
}

function removeCurrentWindow(): void {
  if (state.windows.length <= 1) return // Don't remove last window
  try {
    execSync("tmux kill-window")
    // Refresh window list
    state.windows = getWindows()
    state.currentWindowIndex = state.windows.findIndex(w => w.active)
    if (state.currentWindowIndex < 0) state.currentWindowIndex = 0
  } catch (e) {
    // Ignore errors
  }
}

function applyAndExit(): void {
  const layout = ALL_LAYOUTS[state.layoutIndex]
  const targetWindow = state.windows[state.currentWindowIndex]

  try {
    const windowInfo = getWindowInfo()
    const paneCount = layout.panes.length
    const currentPaneCount = windowInfo.panes.length

    // Switch to target window if different
    if (!targetWindow.active) {
      execSync(`tmux select-window -t :${targetWindow.index}`)
    }

    // Adjust pane count
    if (currentPaneCount < paneCount) {
      // Need more panes - split
      for (let i = currentPaneCount; i < paneCount; i++) {
        execSync(`tmux split-window`)
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
  const tmux = spawn("tmux", [
    "-f", CONFIG_PATH,
    "new-session",
    ";",
    "bind", "-n", "M-Space", "display-popup", "-w", "80%", "-h", "80%", "-E", `bun ${SELF_PATH}`
  ], {
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
  process.stdout.write(ansi.altScreen + ansi.hideCursor)
  process.stdin.setRawMode(true)
  process.stdin.resume()

  render()

  process.stdin.on("data", (data) => {
    const keys = data.toString()
    for (const key of keys) {
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
  process.stdout.write(ansi.showCursor + ansi.exitAltScreen)
  process.stdin.setRawMode(false)
  process.exit(0)
}

process.on("SIGINT", cleanup)
process.on("SIGTERM", cleanup)

main()
