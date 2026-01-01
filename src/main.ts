import { execSync, spawn } from "node:child_process"
import { join } from "node:path"
import { ALL_LAYOUTS, resolveLayout, type LayoutTemplate } from "./layouts"
import { getWindows, getWindowInfo, type TmuxWindow } from "./tmux"
import { generateLayoutString } from "./tmux-layout"

const CONFIG_PATH = join(import.meta.dir, "../config/tmux.conf")
const SELF_PATH = import.meta.path

// ── State ──────────────────────────────────────────────────────────────────
type Focus = "window" | "layout"

interface State {
  windows: TmuxWindow[]
  currentWindowIndex: number
  layoutIndex: number
  overlayOpen: boolean
  searchQuery: string
  overlaySelection: number
  focus: Focus
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
    overlayOpen: false,
    searchQuery: "",
    overlaySelection: 0,
    focus: "layout" as Focus,
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
function renderLayoutPreview(
  template: LayoutTemplate,
  x: number,
  y: number,
  w: number,
  h: number
): string {
  let out = ""
  const innerW = w - 2
  const innerH = h - 2

  // Draw outer border
  out += ansi.moveTo(x, y) + box.tl + box.h.repeat(innerW) + box.tr
  for (let row = 1; row < h - 1; row++) {
    out += ansi.moveTo(x, y + row) + box.v + " ".repeat(innerW) + box.v
  }
  out += ansi.moveTo(x, y + h - 1) + box.bl + box.h.repeat(innerW) + box.br

  // Simple preview: use normalized coords directly (ignore min-height complexity)
  template.panes.forEach((pane, i) => {
    // Convert normalized 0-1 coords to preview coords
    const px = pane.x >= 0 ? pane.x : 0
    const py = pane.y >= 0 ? pane.y : 0.7 // negative y = near bottom
    const pw = pane.width
    const ph = pane.height > 0 && pane.height <= 1 ? pane.height : 0.3

    const cx = x + 1 + Math.floor((px + pw / 2) * innerW)
    const cy = y + 1 + Math.floor((py + ph / 2) * innerH)
    out += ansi.moveTo(cx, cy) + (i + 1).toString()
  })

  return out
}

// ── Main render ────────────────────────────────────────────────────────────
function render(): void {
  const width = process.stdout.columns || 80
  const height = process.stdout.rows || 24

  let out = ansi.clear

  // Window name (top row)
  const windowName = state.windows[state.currentWindowIndex]?.name || "?"
  const windowFocused = state.focus === "window"
  out += ansi.moveTo(1, 0)
  if (windowFocused) out += ansi.inverse
  out += " " + windowName + " ▼ "
  out += ansi.reset

  // Separator
  out += ansi.moveTo(0, 1) + box.h.repeat(width)

  // Layout preview (center area)
  const layout = ALL_LAYOUTS[state.layoutIndex]
  const previewW = Math.min(width - 4, 40)
  const previewH = Math.min(height - 6, 12)
  const previewX = Math.floor((width - previewW) / 2)
  const previewY = 3
  out += renderLayoutPreview(layout, previewX, previewY, previewW, previewH)

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

  // Overlay (if open)
  if (state.overlayOpen) {
    out += renderOverlay(0, 0, width, height - 2)
  }

  process.stdout.write(out)
}

function getFilteredWindows(): TmuxWindow[] {
  const query = state.searchQuery.toLowerCase()
  return state.windows.filter(win =>
    query === "" || win.name.toLowerCase().includes(query)
  )
}

function renderOverlay(x: number, y: number, w: number, h: number): string {
  let out = ""

  // Clear overlay area with background
  for (let row = 0; row < h; row++) {
    out += ansi.moveTo(x, y + row) + " ".repeat(w)
  }

  // Search input
  const prompt = "> " + state.searchQuery
  out += ansi.moveTo(x, y) + ansi.bold + prompt + ansi.reset + "│"

  // Filtered windows
  const filtered = getFilteredWindows()

  filtered.slice(0, h - 1).forEach((win, i) => {
    const isCurrent = win.index === state.windows[state.currentWindowIndex]?.index
    const isSelected = i === state.overlaySelection
    out += ansi.moveTo(x, y + 1 + i)
    if (isSelected) out += ansi.inverse
    out += (isCurrent ? "● " : "  ") + win.name.padEnd(w - 4)
    out += ansi.reset
  })

  return out
}

// ── Input handling ─────────────────────────────────────────────────────────
function handleKey(key: string): boolean {
  if (state.overlayOpen) {
    return handleOverlayKey(key)
  }
  return handleMainKey(key)
}

function handleMainKey(key: string): boolean {
  switch (key) {
    case "\t": // Tab - switch focus
      state.focus = state.focus === "window" ? "layout" : "window"
      break
    case "j": // Down
      if (state.focus === "window") {
        state.overlayOpen = true
        state.searchQuery = ""
        state.overlaySelection = 0
      } else {
        state.layoutIndex = (state.layoutIndex + 1) % ALL_LAYOUTS.length
      }
      break
    case "k": // Up
      if (state.focus === "window") {
        state.overlayOpen = true
        state.searchQuery = ""
        state.overlaySelection = 0
      } else {
        state.layoutIndex = (state.layoutIndex - 1 + ALL_LAYOUTS.length) % ALL_LAYOUTS.length
      }
      break
    case "h":
      state.layoutIndex = (state.layoutIndex - 1 + ALL_LAYOUTS.length) % ALL_LAYOUTS.length
      break
    case "l":
      state.layoutIndex = (state.layoutIndex + 1) % ALL_LAYOUTS.length
      break
    case " ":
    case "\r": // Enter
      if (state.focus === "window") {
        state.overlayOpen = true
        state.searchQuery = ""
        state.overlaySelection = 0
      } else {
        applyAndExit()
        return false
      }
      break
    case "\x1b": // Escape
    case "q":
      return false
    default:
      // Start typing = open overlay with that char
      if (key.length === 1 && key >= "a" && key <= "z") {
        state.overlayOpen = true
        state.searchQuery = key
        state.overlaySelection = 0
        state.focus = "window"
      }
  }
  return true
}

function handleOverlayKey(key: string): boolean {
  const filtered = getFilteredWindows()

  switch (key) {
    case "\x1b": // Escape
      state.overlayOpen = false
      break
    case "\r": // Enter - select current selection
      if (filtered.length > 0) {
        const selected = filtered[state.overlaySelection]
        const idx = state.windows.findIndex(w => w.index === selected.index)
        if (idx >= 0) state.currentWindowIndex = idx
      }
      state.overlayOpen = false
      break
    case "j": // Down
      state.overlaySelection = Math.min(state.overlaySelection + 1, filtered.length - 1)
      break
    case "k": // Up
      state.overlaySelection = Math.max(state.overlaySelection - 1, 0)
      break
    case "\x7f": // Backspace
      state.searchQuery = state.searchQuery.slice(0, -1)
      state.overlaySelection = 0
      break
    default:
      if (key.length === 1 && key >= " ") {
        state.searchQuery += key
        state.overlaySelection = 0
      }
  }
  return true
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
