/**
 * Directory picker with typeahead filtering.
 * Designed for testability with pure functions for state handling and rendering.
 */

import { execSync } from "node:child_process"
import { dirname, join, basename } from "node:path"
import { readdirSync } from "node:fs"
import { box } from "./box-chars"

// ── State ──────────────────────────────────────────────────────────────────

export interface DirPickerState {
  input: string
  cousins: string[]  // directory names (not full paths)
  filtered: string[]
  selectedIndex: number
  parentPath: string  // parent directory path
  currentPath: string  // current pane's working directory
  windowPaths: Set<string>  // basenames of directories that already have windows
  selectedBranch: string | null  // git branch of selected item (computed lazily)
}

export type DirPickerResult =
  | { action: "continue"; state: DirPickerState }
  | { action: "cancel" }
  | { action: "select"; path: string }

// ── Pure Functions ─────────────────────────────────────────────────────────

// Debug logging helper
function debugLog(msg: string) {
  if (process.env.CMUX_DEBUG) {
    const fs = require("fs")
    fs.appendFileSync("/tmp/cmux.log", `[dir-picker] ${msg}\n`)
  }
}

/**
 * Get basenames of directories that currently have tmux windows.
 * These are determined by the pane_current_path of each window.
 */
export function getWindowPathBasenames(): Set<string> {
  const basenames = new Set<string>()
  try {
    // Get the current path of the first pane in each window
    const output = execSync("tmux list-windows -F '#{pane_current_path}'")
      .toString()
      .trim()
    debugLog(`list-windows output: ${JSON.stringify(output)}`)
    for (const path of output.split("\n")) {
      if (path) {
        const base = basename(path)
        debugLog(`  path=${path} -> basename=${base}`)
        basenames.add(base)
      }
    }
    debugLog(`windowPathBasenames: ${JSON.stringify([...basenames])}`)
  } catch (e) {
    debugLog(`getWindowPathBasenames error: ${e}`)
    // Ignore errors (e.g., not in tmux)
  }
  return basenames
}

/**
 * Get git branch for a directory path.
 * Returns null if not a git repo or on error.
 */
export function getGitBranch(dirPath: string): string | null {
  try {
    const branch = execSync(`git -C '${dirPath}' rev-parse --abbrev-ref HEAD 2>/dev/null`)
      .toString()
      .trim()
    if (branch === "HEAD") {
      // Detached HEAD - use short SHA
      return execSync(`git -C '${dirPath}' rev-parse --short HEAD 2>/dev/null`)
        .toString()
        .trim() || null
    }
    return branch || null
  } catch {
    return null
  }
}

/**
 * Initialize directory picker state from a working directory.
 */
export function initDirPickerState(currentPath: string): DirPickerState {
  const parentPath = dirname(currentPath)
  const windowPaths = getWindowPathBasenames()
  const cousins = getCousinDirectories(currentPath, windowPaths)

  // Get branch for initial selection
  const selectedBranch = cousins.length > 0
    ? getGitBranch(join(parentPath, cousins[0]))
    : null

  return {
    input: "",
    cousins,
    filtered: cousins,
    selectedIndex: 0,
    parentPath,
    currentPath,
    windowPaths,
    selectedBranch,
  }
}

/**
 * Get sibling directories (cousins) of the current directory.
 * Ordering: current directory first, then directories without windows (alphabetical),
 * then directories with windows (alphabetical).
 */
export function getCousinDirectories(currentPath: string, windowPaths?: Set<string>): string[] {
  const parentPath = dirname(currentPath)
  const currentName = basename(currentPath)

  debugLog(`getCousinDirectories: currentPath=${currentPath}, currentName=${currentName}`)
  debugLog(`  windowPaths provided: ${windowPaths ? JSON.stringify([...windowPaths]) : 'undefined'}`)

  try {
    const entries = readdirSync(parentPath, { withFileTypes: true })
    const siblings = entries
      .filter(e => e.isDirectory() && !e.name.startsWith(".") && e.name !== currentName)
      .map(e => e.name)

    debugLog(`  siblings (excluding current): ${JSON.stringify(siblings)}`)

    // Sort: no-window directories first (alphabetical), then with-window directories (alphabetical)
    if (windowPaths && windowPaths.size > 0) {
      const noWindow = siblings.filter(name => !windowPaths.has(name))
      const hasWindow = siblings.filter(name => windowPaths.has(name))
      debugLog(`  noWindow: ${JSON.stringify(noWindow)}`)
      debugLog(`  hasWindow: ${JSON.stringify(hasWindow)}`)
      noWindow.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      hasWindow.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      // Current directory first, then no-window siblings, then with-window siblings
      const result = [currentName, ...noWindow, ...hasWindow]
      debugLog(`  final order: ${JSON.stringify(result)}`)
      return result
    } else {
      // No window info - just sort alphabetically
      siblings.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      const result = [currentName, ...siblings]
      debugLog(`  final order (no windowPaths): ${JSON.stringify(result)}`)
      return result
    }
  } catch (e) {
    debugLog(`  getCousinDirectories error: ${e}`)
    return [currentName]
  }
}

/**
 * Filter cousins based on input string (case-insensitive prefix match).
 */
export function filterCousins(cousins: string[], input: string): string[] {
  if (!input) return cousins
  const lowerInput = input.toLowerCase()
  return cousins.filter(name => name.toLowerCase().startsWith(lowerInput))
}

/**
 * Handle a key press and return the result.
 * Pure function: takes state and key, returns new state or action.
 */
export function handleDirPickerKey(
  state: DirPickerState,
  key: string
): DirPickerResult {
  // Escape - cancel
  if (key === "\x1b") {
    return { action: "cancel" }
  }

  // Enter - select
  if (key === "\r") {
    const { input, filtered, selectedIndex, parentPath, currentPath } = state

    if (filtered.length > 0) {
      // Select the highlighted item
      const selectedName = filtered[selectedIndex]
      const selectedPath = join(parentPath, selectedName)
      return { action: "select", path: selectedPath }
    } else if (input.length > 0) {
      // No matches - treat input as relative path from current directory
      const relativePath = join(currentPath, input)
      return { action: "select", path: relativePath }
    }
    return { action: "cancel" }
  }

  // Up arrow or Ctrl+P - move selection up
  if (key === "\x10" || key === "\x1b[A") {
    const newIndex = state.selectedIndex > 0 ? state.selectedIndex - 1 : state.filtered.length - 1
    const newSelectedName = state.filtered[newIndex]
    const newBranch = newSelectedName
      ? getGitBranch(join(state.parentPath, newSelectedName))
      : null
    return {
      action: "continue",
      state: { ...state, selectedIndex: newIndex, selectedBranch: newBranch },
    }
  }

  // Down arrow or Ctrl+N - move selection down
  if (key === "\x0e" || key === "\x1b[B") {
    const newIndex = state.selectedIndex < state.filtered.length - 1 ? state.selectedIndex + 1 : 0
    const newSelectedName = state.filtered[newIndex]
    const newBranch = newSelectedName
      ? getGitBranch(join(state.parentPath, newSelectedName))
      : null
    return {
      action: "continue",
      state: { ...state, selectedIndex: newIndex, selectedBranch: newBranch },
    }
  }

  // Backspace - delete last character
  if (key === "\x7f" || key === "\b") {
    if (state.input.length === 0) {
      return { action: "continue", state }
    }
    const newInput = state.input.slice(0, -1)
    const newFiltered = filterCousins(state.cousins, newInput)
    const newSelectedName = newFiltered.length > 0 ? newFiltered[0] : null
    const newBranch = newSelectedName
      ? getGitBranch(join(state.parentPath, newSelectedName))
      : null
    return {
      action: "continue",
      state: {
        ...state,
        input: newInput,
        filtered: newFiltered,
        selectedIndex: 0,
        selectedBranch: newBranch,
      },
    }
  }

  // Printable character - add to input
  if (key.length === 1 && key >= " " && key <= "~") {
    const newInput = state.input + key
    const newFiltered = filterCousins(state.cousins, newInput)
    const newSelectedName = newFiltered.length > 0 ? newFiltered[0] : null
    const newBranch = newSelectedName
      ? getGitBranch(join(state.parentPath, newSelectedName))
      : null
    return {
      action: "continue",
      state: {
        ...state,
        input: newInput,
        filtered: newFiltered,
        selectedIndex: 0,
        selectedBranch: newBranch,
      },
    }
  }

  // Unknown key - ignore
  return { action: "continue", state }
}

// ── Rendering ──────────────────────────────────────────────────────────────

// ANSI codes for styling
const ansiDim = "\x1b[2m"
const ansiReset = "\x1b[0m"

/**
 * Render the directory picker UI to a string.
 * Pure function: takes state and dimensions, returns string output.
 */
export function renderDirPicker(
  state: DirPickerState,
  width: number,
  height: number
): string {
  const { input, filtered, selectedIndex, windowPaths, selectedBranch } = state

  // Calculate box dimensions
  const boxWidth = Math.min(width - 4, 40)
  const boxHeight = Math.min(height - 4, 12)
  const boxX = Math.floor((width - boxWidth) / 2)
  const boxY = Math.floor((height - boxHeight) / 2)

  // Build the output
  let lines: string[] = []

  // Top border
  lines.push(box.tl + box.h.repeat(boxWidth - 2) + box.tr)

  // Input line with cursor
  const inputLabel = "> "
  const cursor = "\u2588"
  const maxInputLen = boxWidth - 4 - inputLabel.length - cursor.length
  const displayInput = input.length > maxInputLen ? input.slice(-maxInputLen) : input
  const inputLine = inputLabel + displayInput + cursor
  const inputPadded = inputLine.padEnd(boxWidth - 2)
  lines.push(box.v + inputPadded + box.v)

  // Directory listing
  const listHeight = boxHeight - 3  // Account for borders and input line

  // Calculate scroll offset to keep selected item visible
  let scrollOffset = 0
  if (selectedIndex >= listHeight) {
    scrollOffset = selectedIndex - listHeight + 1
  }

  for (let i = 0; i < listHeight; i++) {
    const itemIndex = i + scrollOffset
    if (itemIndex < filtered.length) {
      const name = filtered[itemIndex]
      const isSelected = itemIndex === selectedIndex
      const hasWindow = windowPaths.has(name)
      const prefix = isSelected ? "\u2192 " : "  "
      // Show dot indicator for directories that already have windows
      const suffix = hasWindow ? " \u00b7" : ""

      // For selected item, append branch as dim ghost text
      let branchSuffix = ""
      let branchVisualLen = 0
      if (isSelected && selectedBranch) {
        branchSuffix = ansiDim + " @ " + selectedBranch + ansiReset
        branchVisualLen = 3 + selectedBranch.length  // " @ " + branch
      }

      const maxNameLen = boxWidth - 4 - prefix.length - suffix.length - branchVisualLen
      let displayName = name.length > maxNameLen ? name.slice(0, maxNameLen - 1) + "\u2026" : name
      const visibleLine = prefix + displayName + suffix
      const visibleLen = visibleLine.length + branchVisualLen
      const padding = boxWidth - 2 - visibleLen
      const line = visibleLine + branchSuffix + " ".repeat(Math.max(0, padding))
      lines.push(box.v + line + box.v)
    } else {
      // Empty row
      lines.push(box.v + " ".repeat(boxWidth - 2) + box.v)
    }
  }

  // Bottom border
  lines.push(box.bl + box.h.repeat(boxWidth - 2) + box.br)

  // Position lines at box location using ANSI escape codes
  const ESC = "\x1b"
  const CSI = `${ESC}[`
  const moveTo = (x: number, y: number) => `${CSI}${y + 1};${x + 1}H`

  let output = ""
  for (let i = 0; i < lines.length; i++) {
    output += moveTo(boxX, boxY + i) + lines[i]
  }

  return output
}

/**
 * Render the picker to an array of strings (for testing without ANSI positioning).
 */
export function renderDirPickerLines(
  state: DirPickerState,
  width: number,
  height: number
): string[] {
  const { input, filtered, selectedIndex, windowPaths, selectedBranch } = state

  // Calculate box dimensions
  const boxWidth = Math.min(width - 4, 40)
  const boxHeight = Math.min(height - 4, 12)

  let lines: string[] = []

  // Top border
  lines.push(box.tl + box.h.repeat(boxWidth - 2) + box.tr)

  // Input line with cursor
  const inputLabel = "> "
  const cursor = "\u2588"
  const maxInputLen = boxWidth - 4 - inputLabel.length - cursor.length
  const displayInput = input.length > maxInputLen ? input.slice(-maxInputLen) : input
  const inputLine = inputLabel + displayInput + cursor
  const inputPadded = inputLine.padEnd(boxWidth - 2)
  lines.push(box.v + inputPadded + box.v)

  // Directory listing
  const listHeight = boxHeight - 3  // Account for borders and input line

  let scrollOffset = 0
  if (selectedIndex >= listHeight) {
    scrollOffset = selectedIndex - listHeight + 1
  }

  for (let i = 0; i < listHeight; i++) {
    const itemIndex = i + scrollOffset
    if (itemIndex < filtered.length) {
      const name = filtered[itemIndex]
      const isSelected = itemIndex === selectedIndex
      const hasWindow = windowPaths.has(name)
      const prefix = isSelected ? "\u2192 " : "  "
      // Show dot indicator for directories that already have windows
      const suffix = hasWindow ? " \u00b7" : ""

      // For selected item, append branch as ghost text (no ANSI for test version)
      let branchSuffix = ""
      if (isSelected && selectedBranch) {
        branchSuffix = " @ " + selectedBranch
      }

      const maxNameLen = boxWidth - 4 - prefix.length - suffix.length - branchSuffix.length
      let displayName = name.length > maxNameLen ? name.slice(0, maxNameLen - 1) + "\u2026" : name
      const line = prefix + displayName + suffix + branchSuffix
      const padded = line.padEnd(boxWidth - 2)
      lines.push(box.v + padded + box.v)
    } else {
      lines.push(box.v + " ".repeat(boxWidth - 2) + box.v)
    }
  }

  // Bottom border
  lines.push(box.bl + box.h.repeat(boxWidth - 2) + box.br)

  return lines
}
