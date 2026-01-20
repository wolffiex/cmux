#!/usr/bin/env bun
/**
 * Interactive demo for testing the typeahead component.
 * Run: bun src/typeahead-demo.ts
 */

import {
  handleTypeaheadKey,
  initTypeahead,
  renderTypeahead,
  type TypeaheadItem,
  type TypeaheadState,
} from "./typeahead";

// Sample items for testing
const demoItems: TypeaheadItem[] = [
  { id: "cmux", label: "cmux", hint: "main" },
  { id: "clardio", label: "clardio", hint: "feature-auth", marker: "·" },
  { id: "shellbot", label: "shellbot", hint: "develop" },
  { id: "dotfiles", label: "dotfiles" },
  { id: "notes", label: "notes", marker: "·" },
  { id: "website", label: "website", hint: "redesign-2024" },
  { id: "api-server", label: "api-server", hint: "main", marker: "·" },
  { id: "mobile-app", label: "mobile-app", hint: "feature-notifications" },
];

// ANSI helpers
const ESC = "\x1b";
const CSI = `${ESC}[`;
const ansi = {
  clear: `${CSI}2J${CSI}H`,
  altScreen: `${CSI}?1049h`,
  mainScreen: `${CSI}?1049l`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  moveTo: (x: number, y: number) => `${CSI}${y + 1};${x + 1}H`,
  dim: `${CSI}2m`,
  reset: `${CSI}0m`,
};

// Get terminal size
function getTerminalSize(): { width: number; height: number } {
  return {
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  };
}

// Render the demo
function render(state: TypeaheadState): void {
  const { width, height } = getTerminalSize();

  let output = ansi.clear;

  // Title
  output += ansi.moveTo(2, 1);
  output += `${ansi.dim}Typeahead Demo - Press Escape to exit${ansi.reset}`;

  // Render typeahead
  output += renderTypeahead(state, width, height - 4);

  // Debug info at bottom
  output += ansi.moveTo(2, height - 2);
  output += `${ansi.dim}input: "${state.input}" | filtered: ${state.filtered.length}/${state.items.length} | selected: ${state.selectedIndex}${ansi.reset}`;

  output += ansi.moveTo(2, height - 1);
  const selectedItem = state.filtered[state.selectedIndex];
  output += `${ansi.dim}selected item: ${selectedItem ? `${selectedItem.id} (${selectedItem.label})` : "none"}${ansi.reset}`;

  process.stdout.write(output);
}

// Main
function main(): void {
  if (!process.stdin.isTTY) {
    console.error("Not a TTY");
    process.exit(1);
  }

  // Switch to alt screen
  process.stdout.write(ansi.altScreen + ansi.hideCursor);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  let state = initTypeahead(demoItems, "Choose a repo");
  render(state);

  // Cleanup function
  const cleanup = () => {
    process.stdout.write(ansi.showCursor + ansi.mainScreen);
    process.stdin.setRawMode(false);
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Handle input
  process.stdin.on("data", (data) => {
    const input = data.toString();

    // Parse escape sequences
    let i = 0;
    while (i < input.length) {
      let key: string;

      if (input[i] === ESC && input[i + 1] === "[") {
        // Arrow keys: ESC [ A/B/C/D
        key = input.slice(i, i + 3);
        i += 3;
      } else {
        key = input[i];
        i++;
      }

      const result = handleTypeaheadKey(state, key);

      switch (result.action) {
        case "continue":
          state = result.state;
          render(state);
          break;

        case "cancel":
          cleanup();
          break;

        case "select":
          process.stdout.write(ansi.showCursor + ansi.mainScreen);
          console.log(`\nSelected: ${result.item.id} (${result.item.label})`);
          if (result.item.hint) {
            console.log(`  hint: ${result.item.hint}`);
          }
          process.stdin.setRawMode(false);
          process.exit(0);
          break;

        case "create":
          process.stdout.write(ansi.showCursor + ansi.mainScreen);
          console.log(`\nCreate new: "${result.input}"`);
          process.stdin.setRawMode(false);
          process.exit(0);
          break;
      }
    }
  });
}

main();
