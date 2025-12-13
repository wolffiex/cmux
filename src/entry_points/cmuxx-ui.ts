#!/usr/bin/env bun

import { execSync } from "node:child_process";
import type { WindowInfo, PaneInfo } from "../tmux.ts";
import { renderMinimap, HOMEROW_KEYS } from "../minimap.ts";
import { getLayoutsForCount, resolveLayout, type LayoutTemplate } from "../layouts.ts";
import { generateLayoutString, type LayoutPane } from "../tmux-layout.ts";

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

// Layout state
let currentPaneCount = windowInfo.panes.length;
let layouts = getLayoutsForCount(currentPaneCount);
let currentLayoutIndex = 0;

function getDisplayPanes(): PaneInfo[] {
  if (!layouts) {
    return windowInfo.panes;
  }
  const template = layouts[currentLayoutIndex];
  const resolved = resolveLayout(template, windowInfo.width, windowInfo.height);
  return resolved.map((r, i) => ({
    id: windowInfo.panes[i]?.id || `%${i}`,
    left: r.x,
    top: r.y,
    width: r.width,
    height: r.height,
    title: "",
  }));
}

function layoutToWindowInfo(): WindowInfo {
  return {
    width: windowInfo.width,
    height: windowInfo.height,
    panes: getDisplayPanes(),
  };
}

function render() {
  // Clear screen and move to top
  process.stdout.write("\x1b[2J\x1b[H");

  const leftPad = " ".repeat(Math.floor(padding / 2));
  const displayInfo = layoutToWindowInfo();
  let header: string;

  if (layouts) {
    const template = layouts[currentLayoutIndex];
    header = `${leftPad}${currentPaneCount} panes | ${template.name} (${currentLayoutIndex + 1}/${layouts.length}) | j/k cycle, +/- panes`;
  } else {
    header = `${leftPad}${currentPaneCount} panes | +/- to change`;
  }

  const lines = renderMinimap(displayInfo, { width: mapWidth, height: mapHeight });

  console.log(header);
  console.log();
  console.log(lines.map(line => leftPad + line).join("\n"));
}

function cleanup() {
  process.stdout.write("\x1b[?25h");
}

function applyCurrentLayout() {
  if (!layouts) return;

  try {
    const template = layouts[currentLayoutIndex];
    const resolved = resolveLayout(template, windowInfo.width, windowInfo.height);

    // Build layout panes with original pane IDs
    const layoutPanes: LayoutPane[] = resolved.map((r, i) => ({
      id: windowInfo.panes[i].id,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    }));

    const layoutString = generateLayoutString(layoutPanes, windowInfo.width, windowInfo.height);
    execSync(`tmux select-layout '${layoutString}'`);
  } catch (e) {
    // Layout application failed, continue anyway
    console.error("Failed to apply layout:", e);
  }
}

function selectPane(index: number) {
  cleanup();

  const actualPanes = windowInfo.panes.length;

  // Add panes if needed
  while (windowInfo.panes.length < currentPaneCount) {
    execSync("tmux split-window -h");
    // Refresh pane list
    const output = execSync(
      "tmux list-panes -F '#{pane_id}:#{pane_width}:#{pane_height}:#{pane_left}:#{pane_top}'"
    ).toString().trim();
    windowInfo.panes = output.split("\n").map(line => {
      const [id, width, height, left, top] = line.split(":");
      return { id, width: +width, height: +height, left: +left, top: +top, title: "" };
    });
  }

  // Remove panes if needed
  while (windowInfo.panes.length > currentPaneCount) {
    const lastPane = windowInfo.panes[windowInfo.panes.length - 1];
    execSync(`tmux kill-pane -t ${lastPane.id}`);
    windowInfo.panes.pop();
  }

  // Apply layout
  applyCurrentLayout();

  // Select the target pane
  const targetPane = windowInfo.panes[index];
  if (targetPane) {
    execSync(`tmux select-pane -t ${targetPane.id}`);
  }

  process.exit(0);
}

function changePaneCount(delta: number) {
  const newCount = currentPaneCount + delta;
  if (newCount < 1 || newCount > 4) return;

  currentPaneCount = newCount;
  layouts = getLayoutsForCount(currentPaneCount);
  currentLayoutIndex = 0;
  render();
}

// Initial render
render();

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", (data) => {
  const key = data.toString();
  const upperKey = key.toUpperCase();

  // Layout cycling
  if (layouts && key === "j") {
    currentLayoutIndex = (currentLayoutIndex + 1) % layouts.length;
    render();
    return;
  }
  if (layouts && key === "k") {
    currentLayoutIndex = (currentLayoutIndex - 1 + layouts.length) % layouts.length;
    render();
    return;
  }

  // Change pane count
  if (key === "+" || key === "=") {
    changePaneCount(1);
    return;
  }
  if (key === "-" || key === "_") {
    changePaneCount(-1);
    return;
  }

  // Check if it's a homerow key for a pane in the current layout
  const index = HOMEROW_KEYS.indexOf(upperKey);
  if (index !== -1 && index < currentPaneCount) {
    selectPane(index);
    return;
  }

  // Escape or q to quit
  if (data[0] === 27 || upperKey === "Q") {
    cleanup();
    process.exit(0);
  }
});
