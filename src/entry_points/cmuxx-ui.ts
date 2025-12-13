#!/usr/bin/env bun

import { getWindowInfo } from "../tmux.ts";
import { renderMinimap } from "../minimap.ts";

const window = getWindowInfo();

// Get popup dimensions from terminal size
const cols = process.stdout.columns;
const rows = process.stdout.rows;

// Reserve space for chrome (header/footer)
const chromeRows = 4;
const padding = 2;
const mapWidth = cols - padding;
const mapHeight = rows - chromeRows;

const lines = renderMinimap(window, { width: mapWidth, height: mapHeight });

const leftPad = " ".repeat(Math.floor(padding / 2));
console.log(lines.map(line => leftPad + line).join("\n"));

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.once("data", () => {
  process.exit(0);
});
