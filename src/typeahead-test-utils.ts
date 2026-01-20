/**
 * Test utilities for typeahead component.
 * Import these in test files for easy typeahead testing.
 */

import {
  handleTypeaheadKey,
  renderTypeaheadLines,
  type TypeaheadItem,
  type TypeaheadState,
  type TypeaheadResult,
} from "./typeahead";

// ── Special Keys ────────────────────────────────────────────────────────────

export const Keys = {
  ENTER: "\r",
  ESCAPE: "\x1b",
  BACKSPACE: "\x7f",
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  LEFT: "\x1b[D",
  RIGHT: "\x1b[C",
  CTRL_N: "\x0e",
  CTRL_P: "\x10",
  TAB: "\t",
} as const;

// ── Simulation Helpers ──────────────────────────────────────────────────────

/**
 * Simulate typing a string and return final state.
 * Throws if any key causes a non-continue action.
 */
export function type(state: TypeaheadState, text: string): TypeaheadState {
  let current = state;
  for (const char of text) {
    const result = handleTypeaheadKey(current, char);
    if (result.action !== "continue") {
      throw new Error(`Unexpected action ${result.action} while typing "${text}"`);
    }
    current = result.state;
  }
  return current;
}

/**
 * Simulate a sequence of keys and return final result.
 * Stops early if a terminal action (select/cancel/create) is reached.
 */
export function simulate(
  state: TypeaheadState,
  ...keys: string[]
): TypeaheadResult {
  let current = state;
  for (let i = 0; i < keys.length; i++) {
    const result = handleTypeaheadKey(current, keys[i]);
    if (result.action !== "continue") {
      return result;
    }
    current = result.state;
  }
  return { action: "continue", state: current };
}

/**
 * Simulate keys and return the final state (throws if terminal action).
 */
export function simulateState(
  state: TypeaheadState,
  ...keys: string[]
): TypeaheadState {
  const result = simulate(state, ...keys);
  if (result.action !== "continue") {
    throw new Error(`Unexpected terminal action: ${result.action}`);
  }
  return result.state;
}

// ── State Inspection ────────────────────────────────────────────────────────

/**
 * Get the currently selected item from state.
 */
export function selected(state: TypeaheadState): TypeaheadItem | undefined {
  return state.filtered[state.selectedIndex];
}

/**
 * Get labels of all filtered items.
 */
export function filteredLabels(state: TypeaheadState): string[] {
  return state.filtered.map((item) => item.label);
}

/**
 * Get IDs of all filtered items.
 */
export function filteredIds(state: TypeaheadState): string[] {
  return state.filtered.map((item) => item.id);
}

// ── Render Inspection ───────────────────────────────────────────────────────

/**
 * Render and return just the visible item lines (no borders, ANSI stripped).
 */
export function renderedItems(
  state: TypeaheadState,
  width = 60,
  height = 20,
): string[] {
  const lines = renderTypeaheadLines(state, width, height);
  // Skip: top border, input line, separator; stop before bottom border
  return lines
    .slice(3, -1)
    .map((line) =>
      line
        .slice(1, -1) // remove box chars
        .replace(/\x1b\[[0-9;]*m/g, "") // strip ANSI
        .trim()
    )
    .filter(Boolean);
}

/**
 * Get the input line from rendered output.
 */
export function renderedInput(
  state: TypeaheadState,
  width = 60,
  height = 20,
): string {
  const lines = renderTypeaheadLines(state, width, height);
  return lines[1]
    .slice(1, -1) // remove box chars
    .replace(/\x1b\[[0-9;]*m/g, "") // strip ANSI
    .trim();
}

// ── Assertions ──────────────────────────────────────────────────────────────

/**
 * Assert that a result is a selection of a specific item.
 */
export function assertSelect(
  result: TypeaheadResult,
  expectedId: string,
): asserts result is { action: "select"; item: TypeaheadItem } {
  if (result.action !== "select") {
    throw new Error(`Expected select action, got ${result.action}`);
  }
  if (result.item.id !== expectedId) {
    throw new Error(`Expected selection of "${expectedId}", got "${result.item.id}"`);
  }
}

/**
 * Assert that a result is a create action with specific input.
 */
export function assertCreate(
  result: TypeaheadResult,
  expectedInput: string,
): asserts result is { action: "create"; input: string } {
  if (result.action !== "create") {
    throw new Error(`Expected create action, got ${result.action}`);
  }
  if (result.input !== expectedInput) {
    throw new Error(`Expected create input "${expectedInput}", got "${result.input}"`);
  }
}

/**
 * Assert that a result is a cancel action.
 */
export function assertCancel(
  result: TypeaheadResult,
): asserts result is { action: "cancel" } {
  if (result.action !== "cancel") {
    throw new Error(`Expected cancel action, got ${result.action}`);
  }
}

/**
 * Assert that a result is a continue action and return the state.
 */
export function assertContinue(
  result: TypeaheadResult,
): TypeaheadState {
  if (result.action !== "continue") {
    throw new Error(`Expected continue action, got ${result.action}`);
  }
  return result.state;
}
