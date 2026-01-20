/**
 * Generic typeahead component with filtering and selection.
 * Designed for reuse across directory picker, repo picker, branch picker, etc.
 */

import { box } from "./box-chars";

// ── Types ───────────────────────────────────────────────────────────────────

export interface TypeaheadItem {
  id: string;           // unique identifier (used for selection)
  label: string;        // display text (used for filtering)
  hint?: string;        // secondary text shown dimmed (e.g., branch name)
  marker?: string;      // indicator shown after label (e.g., "·" for existing)
  icon?: string;        // icon shown after arrow when selected (e.g., "📦")
}

export interface TypeaheadState {
  input: string;
  items: TypeaheadItem[];
  filtered: TypeaheadItem[];
  selectedIndex: number;
  title?: string;
}

export type TypeaheadResult =
  | { action: "continue"; state: TypeaheadState }
  | { action: "cancel" }
  | { action: "select"; item: TypeaheadItem }
  | { action: "create"; input: string };  // when input doesn't match any item

// ── State Management ────────────────────────────────────────────────────────

/**
 * Initialize typeahead state with items.
 */
export function initTypeahead(
  items: TypeaheadItem[],
  title?: string,
): TypeaheadState {
  return {
    input: "",
    items,
    filtered: items,
    selectedIndex: 0,
    title,
  };
}

/**
 * Check if input matches label using fuzzy path matching.
 * Matches input as consecutive substrings across path segments.
 * E.g., "codebex" matches "~/code/beatzero/examples" because:
 *   - "code" matches segment "code"
 *   - "be" matches prefix of segment "beatzero"
 *   - "x" matches substring in segment "examples"
 */
function matchesFuzzyPath(label: string, input: string): boolean {
  const segments = label.toLowerCase().split("/");
  const lowerInput = input.toLowerCase();

  let inputPos = 0;

  for (const segment of segments) {
    if (inputPos >= lowerInput.length) break;

    // Find where remaining input starts matching in this segment
    const remaining = lowerInput.slice(inputPos);
    let segStart = 0;

    // Look for the first character of remaining input in segment
    while (segStart < segment.length) {
      if (segment[segStart] === remaining[0]) {
        // Found start, try to match as many consecutive chars as possible
        let matchLen = 0;
        while (
          matchLen < segment.length - segStart &&
          matchLen < remaining.length &&
          segment[segStart + matchLen] === remaining[matchLen]
        ) {
          matchLen++;
        }

        if (matchLen > 0) {
          inputPos += matchLen;
          break;
        }
      }
      segStart++;
    }
  }

  return inputPos === lowerInput.length;
}

/**
 * Filter items based on input.
 * Uses fuzzy path matching (matches across path segments) with
 * fallback to simple substring match.
 */
export function filterItems(
  items: TypeaheadItem[],
  input: string,
): TypeaheadItem[] {
  if (!input) return items;
  const lower = input.toLowerCase();
  return items.filter(
    (item) =>
      matchesFuzzyPath(item.label, input) ||
      item.label.toLowerCase().includes(lower)
  );
}

/**
 * Handle a key press and return the result.
 */
export function handleTypeaheadKey(
  state: TypeaheadState,
  key: string,
): TypeaheadResult {
  // Escape - cancel
  if (key === "\x1b") {
    return { action: "cancel" };
  }

  // Enter - select or create
  if (key === "\r") {
    const { input, filtered, selectedIndex } = state;

    if (filtered.length > 0) {
      return { action: "select", item: filtered[selectedIndex] };
    } else if (input.length > 0) {
      return { action: "create", input };
    }
    return { action: "cancel" };
  }

  // Up arrow or Ctrl+P
  if (key === "\x10" || key === "\x1b[A") {
    const newIndex =
      state.selectedIndex > 0
        ? state.selectedIndex - 1
        : state.filtered.length - 1;
    return {
      action: "continue",
      state: { ...state, selectedIndex: newIndex },
    };
  }

  // Down arrow or Ctrl+N
  if (key === "\x0e" || key === "\x1b[B") {
    const newIndex =
      state.selectedIndex < state.filtered.length - 1
        ? state.selectedIndex + 1
        : 0;
    return {
      action: "continue",
      state: { ...state, selectedIndex: newIndex },
    };
  }

  // Backspace
  if (key === "\x7f" || key === "\b") {
    if (state.input.length === 0) {
      return { action: "continue", state };
    }
    const newInput = state.input.slice(0, -1);
    const newFiltered = filterItems(state.items, newInput);
    return {
      action: "continue",
      state: {
        ...state,
        input: newInput,
        filtered: newFiltered,
        selectedIndex: 0,
      },
    };
  }

  // Printable character
  if (key.length === 1 && key >= " " && key <= "~") {
    const newInput = state.input + key;
    const newFiltered = filterItems(state.items, newInput);
    return {
      action: "continue",
      state: {
        ...state,
        input: newInput,
        filtered: newFiltered,
        selectedIndex: 0,
      },
    };
  }

  return { action: "continue", state };
}

// ── Rendering ───────────────────────────────────────────────────────────────

const ansiDim = "\x1b[2m";
const ansiReset = "\x1b[0m";

/**
 * Render the typeahead UI to a string with ANSI positioning.
 */
export function renderTypeahead(
  state: TypeaheadState,
  width: number,
  height: number,
): string {
  const lines = renderTypeaheadLines(state, width, height);

  const boxWidth = Math.min(width - 4, 50);
  const boxHeight = Math.min(height - 4, 14);
  const boxX = Math.floor((width - boxWidth) / 2);
  const boxY = Math.floor((height - boxHeight) / 2);

  const ESC = "\x1b";
  const CSI = `${ESC}[`;
  const moveTo = (x: number, y: number) => `${CSI}${y + 1};${x + 1}H`;

  let output = "";
  for (let i = 0; i < lines.length; i++) {
    output += moveTo(boxX, boxY + i) + lines[i];
  }

  return output;
}

/**
 * Render to array of strings (for testing).
 */
export function renderTypeaheadLines(
  state: TypeaheadState,
  width: number,
  height: number,
): string[] {
  const { input, filtered, selectedIndex, title } = state;

  const boxWidth = Math.min(width - 4, 50);
  const boxHeight = Math.min(height - 4, 14);

  const lines: string[] = [];

  // Top border with optional title
  if (title) {
    const titleText = ` ${title} `;
    const leftPad = Math.floor((boxWidth - 2 - titleText.length) / 2);
    const rightPad = boxWidth - 2 - leftPad - titleText.length;
    lines.push(
      box.tl +
        box.h.repeat(leftPad) +
        titleText +
        box.h.repeat(rightPad) +
        box.tr
    );
  } else {
    lines.push(box.tl + box.h.repeat(boxWidth - 2) + box.tr);
  }

  // Input line with cursor
  const inputLabel = "> ";
  const cursor = "\u2588";
  const maxInputLen = boxWidth - 4 - inputLabel.length - cursor.length;
  const displayInput =
    input.length > maxInputLen ? input.slice(-maxInputLen) : input;
  const inputLine = inputLabel + displayInput + cursor;
  const inputPadded = inputLine.padEnd(boxWidth - 2);
  lines.push(box.v + inputPadded + box.v);

  // Separator
  lines.push(box.ltee + box.h.repeat(boxWidth - 2) + box.rtee);

  // Item listing
  const listHeight = boxHeight - 4; // borders, input, separator

  let scrollOffset = 0;
  if (selectedIndex >= listHeight) {
    scrollOffset = selectedIndex - listHeight + 1;
  }

  for (let i = 0; i < listHeight; i++) {
    const itemIndex = i + scrollOffset;
    if (itemIndex < filtered.length) {
      const item = filtered[itemIndex];
      const isSelected = itemIndex === selectedIndex;
      const icon = isSelected && item.icon ? `${item.icon} ` : "";
      const prefix = isSelected ? `\u2192 ${icon}` : "  ";
      const marker = item.marker ? ` ${item.marker}` : "";

      // Calculate available space for label and hint
      let hintText = "";
      let hintLen = 0;
      if (isSelected && item.hint) {
        hintText = `${ansiDim} ${item.hint}${ansiReset}`;
        hintLen = 1 + item.hint.length;
      }

      const maxLabelLen = boxWidth - 4 - prefix.length - marker.length - hintLen;
      const displayLabel =
        item.label.length > maxLabelLen
          ? `${item.label.slice(0, maxLabelLen - 1)}\u2026`
          : item.label;

      const visibleLine = prefix + displayLabel + marker;
      const visibleLen = visibleLine.length + hintLen;
      const padding = boxWidth - 2 - visibleLen;
      const line = visibleLine + hintText + " ".repeat(Math.max(0, padding));
      lines.push(box.v + line + box.v);
    } else {
      lines.push(box.v + " ".repeat(boxWidth - 2) + box.v);
    }
  }

  // Bottom border
  lines.push(box.bl + box.h.repeat(boxWidth - 2) + box.br);

  return lines;
}
