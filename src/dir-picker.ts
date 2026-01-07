/**
 * Directory picker with typeahead filtering.
 * Designed for testability with pure functions for state handling and rendering.
 */

import { dirname, join, basename } from "node:path"
import { readdirSync } from "node:fs"

// ── State ──────────────────────────────────────────────────────────────────

export interface DirPickerState {
  input: string
  cousins: string[]  // directory names (not full paths)
  filtered: string[]
  selectedIndex: number
  parentPath: string  // parent directory path
  currentPath: string  // current pane's working directory
}

export type DirPickerResult =
  | { action: "continue"; state: DirPickerState }
  | { action: "cancel" }
  | { action: "select"; path: string }

// ── Pure Functions ─────────────────────────────────────────────────────────

/**
 * Initialize directory picker state from a working directory.
 */
export function initDirPickerState(currentPath: string): DirPickerState {
  const parentPath = dirname(currentPath)
  const cousins = getCousinDirectories(currentPath)

  return {
    input: "",
    cousins,
    filtered: cousins,
    selectedIndex: 0,
    parentPath,
    currentPath,
  }
}

/**
 * Get sibling directories (cousins) of the current directory.
 * The current directory is always returned first, followed by siblings sorted alphabetically.
 */
export function getCousinDirectories(currentPath: string): string[] {
  const parentPath = dirname(currentPath)
  const currentName = basename(currentPath)

  try {
    const entries = readdirSync(parentPath, { withFileTypes: true })
    const siblings = entries
      .filter(e => e.isDirectory() && !e.name.startsWith(".") && e.name !== currentName)
      .map(e => e.name)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    // Current directory first, then sorted siblings
    return [currentName, ...siblings]
  } catch {
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
    return {
      action: "continue",
      state: { ...state, selectedIndex: newIndex },
    }
  }

  // Down arrow or Ctrl+N - move selection down
  if (key === "\x0e" || key === "\x1b[B") {
    const newIndex = state.selectedIndex < state.filtered.length - 1 ? state.selectedIndex + 1 : 0
    return {
      action: "continue",
      state: { ...state, selectedIndex: newIndex },
    }
  }

  // Backspace - delete last character
  if (key === "\x7f" || key === "\b") {
    if (state.input.length === 0) {
      return { action: "continue", state }
    }
    const newInput = state.input.slice(0, -1)
    const newFiltered = filterCousins(state.cousins, newInput)
    return {
      action: "continue",
      state: {
        ...state,
        input: newInput,
        filtered: newFiltered,
        selectedIndex: 0,
      },
    }
  }

  // Printable character - add to input
  if (key.length === 1 && key >= " " && key <= "~") {
    const newInput = state.input + key
    const newFiltered = filterCousins(state.cousins, newInput)
    return {
      action: "continue",
      state: {
        ...state,
        input: newInput,
        filtered: newFiltered,
        selectedIndex: 0,
      },
    }
  }

  // Unknown key - ignore
  return { action: "continue", state }
}

// ── Rendering ──────────────────────────────────────────────────────────────

const box = {
  tl: "┌", tr: "┐", bl: "└", br: "┘",
  h: "─", v: "│",
}

/**
 * Render the directory picker UI to a string.
 * Pure function: takes state and dimensions, returns string output.
 */
export function renderDirPicker(
  state: DirPickerState,
  width: number,
  height: number
): string {
  const { input, filtered, selectedIndex } = state

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
  const cursor = "█"
  const maxInputLen = boxWidth - 4 - inputLabel.length - cursor.length
  const displayInput = input.length > maxInputLen ? input.slice(-maxInputLen) : input
  const inputLine = inputLabel + displayInput + cursor
  const inputPadded = inputLine.padEnd(boxWidth - 2)
  lines.push(box.v + inputPadded + box.v)

  // Empty line separator
  lines.push(box.v + " ".repeat(boxWidth - 2) + box.v)

  // Directory listing
  const listHeight = boxHeight - 4  // Account for borders, input, separator
  const visibleCount = Math.min(filtered.length, listHeight)

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
      const prefix = isSelected ? "→ " : "  "
      const maxNameLen = boxWidth - 4 - prefix.length
      const displayName = name.length > maxNameLen ? name.slice(0, maxNameLen - 1) + "…" : name
      const line = prefix + displayName
      const padded = line.padEnd(boxWidth - 2)
      lines.push(box.v + padded + box.v)
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
  const { input, filtered, selectedIndex } = state

  // Calculate box dimensions
  const boxWidth = Math.min(width - 4, 40)
  const boxHeight = Math.min(height - 4, 12)

  let lines: string[] = []

  // Top border
  lines.push(box.tl + box.h.repeat(boxWidth - 2) + box.tr)

  // Input line with cursor
  const inputLabel = "> "
  const cursor = "█"
  const maxInputLen = boxWidth - 4 - inputLabel.length - cursor.length
  const displayInput = input.length > maxInputLen ? input.slice(-maxInputLen) : input
  const inputLine = inputLabel + displayInput + cursor
  const inputPadded = inputLine.padEnd(boxWidth - 2)
  lines.push(box.v + inputPadded + box.v)

  // Empty line separator
  lines.push(box.v + " ".repeat(boxWidth - 2) + box.v)

  // Directory listing
  const listHeight = boxHeight - 4

  let scrollOffset = 0
  if (selectedIndex >= listHeight) {
    scrollOffset = selectedIndex - listHeight + 1
  }

  for (let i = 0; i < listHeight; i++) {
    const itemIndex = i + scrollOffset
    if (itemIndex < filtered.length) {
      const name = filtered[itemIndex]
      const isSelected = itemIndex === selectedIndex
      const prefix = isSelected ? "→ " : "  "
      const maxNameLen = boxWidth - 4 - prefix.length
      const displayName = name.length > maxNameLen ? name.slice(0, maxNameLen - 1) + "…" : name
      const line = prefix + displayName
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
