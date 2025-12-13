#!/usr/bin/env bun

import { execSync } from "node:child_process";
import type { WindowInfo } from "../tmux.ts";
import { renderMinimap, HOMEROW_KEYS } from "../minimap.ts";

// Hide cursor
process.stdout.write("\x1b[?25l");

// Receive window info from cmuxx as base64-encoded JSON arg
const encoded = process.argv[2];
if (!encoded) {
  console.error("Usage: cmuxx-ui <base64-encoded-window-info>");
  process.exit(1);
}
const windowInfo: WindowInfo = JSON.parse(Buffer.from(encoded, "base64").toString());

// Get popup dimensions from terminal size
const cols = process.stdout.columns;
const rows = process.stdout.rows;

// Reserve space for chrome (header/footer)
const chromeRows = 4;
const padding = 2;
const mapWidth = cols - padding;
const mapHeight = rows - chromeRows;

const lines = renderMinimap(windowInfo, { width: mapWidth, height: mapHeight });

const leftPad = " ".repeat(Math.floor(padding / 2));
console.log(lines.map(line => leftPad + line).join("\n"));

function cleanup() {
  process.stdout.write("\x1b[?25h");
}

function selectPane(index: number) {
  const pane = windowInfo.panes[index];
  if (pane) {
    cleanup();
    execSync(`tmux select-pane -t ${pane.id}`);
    process.exit(0);
  }
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", (data) => {
  const key = data.toString().toUpperCase();

  // Check if it's a homerow key
  const index = HOMEROW_KEYS.indexOf(key);
  if (index !== -1 && index < windowInfo.panes.length) {
    selectPane(index);
    return;
  }

  // Escape or q to quit
  if (data[0] === 27 || key === "Q") {
    cleanup();
    process.exit(0);
  }
});
