const _startTime = performance.now();

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { box } from "./box-chars";
import {
  type BranchPickerState,
  handleBranchPickerKey,
  initBranchPicker,
} from "./branch-picker";
import { closeDb } from "./db";
import { renderLayoutPreview } from "./layout-preview";
import { recordTransition } from "./layout-store";
import { ALL_LAYOUTS, type LayoutTemplate, resolveLayout } from "./layouts";
import { initLog, log } from "./logger";
import { matchPanesToSlots, type Pane, type Slot } from "./pane-matcher";
import {
  handleRepoPickerKey,
  initRepoPicker,
  type RepoPickerState,
  setRepoPickerCwd,
} from "./repo-picker";
import { collectReposFromWindows, trackRepo } from "./repo-store";
import { computeSwaps, executeSwaps } from "./swap-orchestrator";
import {
  getStartupInfo,
  getWindowInfo,
  getWindowInfoForWindow,
  getWindows,
  STARTUP_COMMAND,
  type TmuxWindow,
} from "./tmux";
import { generateLayoutString } from "./tmux-layout";
import { renderTypeaheadLines } from "./typeahead";
import { easeOut, splitWindowName, stripAnsi } from "./utils";
import { deleteWorktree } from "./worktree-utils";

const CONFIG_PATH = join(import.meta.dir, "../config/tmux.conf");
const SELF_PATH = import.meta.path;

// ── State ──────────────────────────────────────────────────────────────────
type AnimationDirection = "left" | "right" | null;
type Focus = "typeahead" | "carousel" | "layout";
// Sub-focus within layout mode: which element has focus
type LayoutField = "picker" | "directory" | "repo" | "branch";
// What's shown in the typeahead area
type TypeaheadMode = "picker" | "branchPicker";

interface State {
  windows: TmuxWindow[];
  currentWindowIndex: number;
  layoutIndex: number;
  carouselIndex: number; // 0..n-1 = windows (direct index)
  focus: Focus;
  typeaheadMode: TypeaheadMode;
  // Layout mode sub-focus
  layoutField: LayoutField;
  // Animation state (for layout)
  animating: boolean;
  animationDirection: AnimationDirection;
  animationFrame: number;
  previousLayoutIndex: number;
  // Window swap animation state
  windowSwapAnimating: boolean;
  windowSwapDirection: AnimationDirection;
  windowSwapFrame: number;
  windowSwapFromIndex: number; // Index in windows array
  windowSwapToIndex: number; // Index in windows array
  // Delete confirmation state
  confirmingDelete: boolean;
  // Repo picker state
  picker: RepoPickerState | null;
  // Branch picker state
  branchPicker: BranchPickerState | null;
}

/**
 * Renumber windows sequentially to eliminate gaps.
 * Uses tmux move-window -r which respects the session's base-index setting.
 */
function renumberWindows(): void {
  try {
    execFileSync("tmux", ["move-window", "-r"], { stdio: "ignore" });
  } catch (_e) {
    // Ignore errors (e.g., not in tmux)
  }
}

// ── Benchmark mode ─────────────────────────────────────────────────────────
const BENCHMARK_MODE = !!process.env.CMUX_BENCHMARK;

// Profiling helper for benchmark mode
const profile = BENCHMARK_MODE
  ? (label: string, fn: () => void) => {
      const start = performance.now();
      fn();
      console.error(`${label}: ${(performance.now() - start).toFixed(1)}ms`);
    }
  : (_label: string, fn: () => void) => fn();

function initState(): State {
  let windows: TmuxWindow[] = [];
  let currentWindowIndex = 0;
  try {
    // Read prefetched tmux data from process substitution fd, or fall back to spawning
    let startupInfo!: ReturnType<typeof getStartupInfo>;
    profile("getStartupInfo", () => {
      const prefetchPath = process.argv.find(
        (a) => a.startsWith("/dev/fd/") || a.startsWith("/proc/"),
      );
      if (prefetchPath) {
        try {
          const text = readFileSync(prefetchPath, "utf-8").trim();
          if (text) {
            startupInfo = getStartupInfo(text);
            return;
          }
        } catch {
          // Fall through to synchronous spawn
        }
      }
      startupInfo = getStartupInfo();
    });
    windows = startupInfo.windows;
    currentWindowIndex = windows.findIndex((w) => w.active);
    if (currentWindowIndex < 0) currentWindowIndex = 0;
  } catch (_e) {
    // Not in tmux - use dummy data for testing
    windows = [
      {
        index: 0,
        name: "backend",
        active: true,
        bell: false,
        activity: false,
        paneCommand: "",
      },
      {
        index: 1,
        name: "frontend",
        active: false,
        bell: false,
        activity: false,
        paneCommand: "",
      },
      {
        index: 2,
        name: "logs",
        active: false,
        bell: false,
        activity: false,
        paneCommand: "",
      },
    ];
  }

  return {
    windows,
    currentWindowIndex,
    layoutIndex: 0,
    carouselIndex: currentWindowIndex, // Start on current window
    focus: "carousel",
    typeaheadMode: "picker",
    layoutField: "picker",
    // Animation state (for layout)
    animating: false,
    animationDirection: null,
    animationFrame: 0,
    previousLayoutIndex: 0,
    // Window swap animation state
    windowSwapAnimating: false,
    windowSwapDirection: null,
    windowSwapFrame: 0,
    windowSwapFromIndex: -1,
    windowSwapToIndex: -1,
    // Delete confirmation state
    confirmingDelete: false,
    // Repo picker state (deferred — initialized after first render for faster startup)
    picker: null,
    // Branch picker state
    branchPicker: null,
  };
}

// State is initialized lazily in runUI() after alt-screen switch for faster visual feedback
let state: State;

// ── Polling ────────────────────────────────────────────────────────────────
let pollInterval: Timer | null = null;
const POLL_INTERVAL_MS = 1500;

function windowsChanged(
  oldWindows: TmuxWindow[],
  newWindows: TmuxWindow[],
): boolean {
  if (oldWindows.length !== newWindows.length) return true;
  return oldWindows.some(
    (w, i) =>
      w.name !== newWindows[i].name ||
      w.index !== newWindows[i].index ||
      w.active !== newWindows[i].active,
  );
}

function startPolling(): void {
  pollInterval = setInterval(async () => {
    try {
      const newWindows = getWindows();
      if (windowsChanged(state.windows, newWindows)) {
        // Update current window index if active window changed
        const newActiveIndex = newWindows.findIndex((w) => w.active);
        if (
          newActiveIndex >= 0 &&
          state.currentWindowIndex !== newActiveIndex
        ) {
          state.currentWindowIndex = newActiveIndex;
        }
        // Clamp current index if windows were removed
        if (state.currentWindowIndex >= newWindows.length) {
          state.currentWindowIndex = Math.max(0, newWindows.length - 1);
        }
        state.windows = newWindows;
        render();
      }
    } catch {
      // Ignore polling errors (e.g., not in tmux)
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ── ANSI helpers ───────────────────────────────────────────────────────────
const ESC = "\x1b";
const CSI = `${ESC}[`;

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
  white: `${CSI}97m`, // Bright white foreground
  red: `${CSI}91m`, // Bright red foreground
};

// Superscript digits for window numbering
const superscript = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

// ── Layout matching ─────────────────────────────────────────────────────────
/**
 * Find the layout that best matches the given window's pane arrangement.
 * Returns the index in ALL_LAYOUTS of the best matching layout.
 */
function findBestMatchingLayout(
  windowWidth: number,
  windowHeight: number,
  panes: Array<{
    id: string;
    left: number;
    top: number;
    width: number;
    height: number;
  }>,
): number {
  const currentPanes: Pane[] = panes.map((p) => ({
    id: p.id,
    x: p.left,
    y: p.top,
    width: p.width,
    height: p.height,
  }));

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < ALL_LAYOUTS.length; i++) {
    const layout = ALL_LAYOUTS[i];

    // Only consider layouts with matching pane count
    if (layout.panes.length !== panes.length) continue;

    // Resolve layout to absolute coordinates
    const resolved = resolveLayout(layout, windowWidth, windowHeight);
    const slots: Slot[] = resolved.map((r) => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    }));

    // Score the match
    const { matches } = matchPanesToSlots(currentPanes, slots);
    const totalScore = matches.reduce((sum, m) => sum + m.score, 0);

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestIndex = i;
    }
  }

  return bestIndex;
}

/**
 * Resolve the cwd of the currently selected carousel window via tmux.
 * Falls back to $HOME on any failure.
 */
function getSelectedCarouselCwd(): string {
  const fallback = process.env.HOME || "/";
  const selectedWindow = state.windows[state.carouselIndex];
  if (!selectedWindow) return fallback;
  try {
    const paneCwd = execFileSync("tmux", [
      "display-message",
      "-t",
      `:${selectedWindow.index}`,
      "-p",
      "#{pane_current_path}",
    ])
      .toString()
      .trim();
    return paneCwd || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Refresh the picker's shell-command cwd hint if a picker exists.
 */
function refreshPickerCwd(): void {
  if (state.picker) {
    state.picker = setRepoPickerCwd(state.picker, getSelectedCarouselCwd());
  }
}

/**
 * Update the layout picker to match the currently selected window's layout.
 * Called when carousel selection changes to a window.
 */
function updateLayoutForSelectedWindow(): void {
  const windowIndex = state.carouselIndex;
  if (windowIndex < 0 || windowIndex >= state.windows.length) return;

  const selectedWindow = state.windows[windowIndex];
  try {
    const windowInfo = getWindowInfoForWindow(selectedWindow.index);
    const bestLayout = findBestMatchingLayout(
      windowInfo.width,
      windowInfo.height,
      windowInfo.panes,
    );
    if (bestLayout !== state.layoutIndex) {
      state.layoutIndex = bestLayout;
    }
  } catch {
    // Ignore errors (e.g., window no longer exists)
  }
}

// ── Layout rendering ───────────────────────────────────────────────────────
function drawLayoutPreview(
  template: LayoutTemplate,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  const lines = renderLayoutPreview(template, w, h);
  let out = "";
  lines.forEach((line, i) => {
    out += ansi.moveTo(x, y + i) + line;
  });
  return out;
}

// ── Animation constants ────────────────────────────────────────────────────
const ANIMATION_FRAMES = 12;
const ANIMATION_FRAME_MS = 16;

// ── Animation rendering ────────────────────────────────────────────────────
function renderAnimationFrame(
  prevLayout: LayoutTemplate,
  nextLayout: LayoutTemplate,
  direction: AnimationDirection,
  frame: number,
  previewX: number,
  previewY: number,
  previewW: number,
  previewH: number,
): string {
  // Render both layouts
  const prevLines = renderLayoutPreview(prevLayout, previewW, previewH);
  const nextLines = renderLayoutPreview(nextLayout, previewW, previewH);

  // Calculate offset based on animation progress (0 to 1)
  const progress = frame / ANIMATION_FRAMES;
  // Use ease-out for smooth deceleration
  const eased = 1 - (1 - progress) ** 2;
  const offset = Math.round(previewW * eased);

  let out = "";

  for (let row = 0; row < previewH; row++) {
    const prevLine = prevLines[row] || "";
    const nextLine = nextLines[row] || "";

    // Build the visible portion of this row
    let visibleChars = "";

    if (direction === "right") {
      // New layout slides in from right: prev moves left, next enters from right
      // At frame 0: show prev fully
      // At final frame: show next fully
      for (let col = 0; col < previewW; col++) {
        const sourceCol = col + offset;
        if (sourceCol < previewW) {
          // Still showing prev layout (shifted left)
          visibleChars += prevLine[sourceCol] || " ";
        } else {
          // Showing next layout entering from right
          const nextCol = sourceCol - previewW;
          visibleChars += nextLine[nextCol] || " ";
        }
      }
    } else {
      // direction === "left": New layout slides in from left
      // prev moves right, next enters from left
      for (let col = 0; col < previewW; col++) {
        const sourceCol = col - offset;
        if (sourceCol >= 0) {
          // Still showing prev layout (shifted right)
          visibleChars += prevLine[sourceCol] || " ";
        } else {
          // Showing next layout entering from left
          const nextCol = previewW + sourceCol;
          visibleChars += nextLine[nextCol] || " ";
        }
      }
    }

    out += ansi.moveTo(previewX, previewY + row) + visibleChars;
  }

  return out;
}

function startAnimation(direction: AnimationDirection): void {
  state.animating = true;
  state.animationDirection = direction;
  state.animationFrame = 0;

  const prevLayout = ALL_LAYOUTS[state.previousLayoutIndex];
  const nextLayout = ALL_LAYOUTS[state.layoutIndex];

  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;

  // Use same positioning as render() - centered in the terminal
  const maxContentWidth = 100;
  const contentWidth = Math.min(width, maxContentWidth);
  const previewW = Math.min(40, Math.floor(contentWidth / 2));
  const previewH = Math.min(height - 11, 12);
  const previewX = Math.floor((width - previewW) / 2);
  const previewY = 8; // Start after carousel (6 rows) + separator (1 row) + gap (1 row)

  // Update the counter immediately (shows new layout info)
  const paneCount = nextLayout.panes.length;
  const layoutFocused = state.focus === "layout";
  const counter = `${paneCount} pane${paneCount > 1 ? "s" : ""} · ${state.layoutIndex + 1}/${ALL_LAYOUTS.length}`;
  const counterX = previewX + Math.floor((previewW - counter.length) / 2);
  let counterOut = ansi.moveTo(counterX, previewY + previewH);
  if (layoutFocused) counterOut += ansi.inverse;
  counterOut += ` ${counter} `;
  counterOut += ansi.reset;
  process.stdout.write(counterOut);

  const tick = () => {
    state.animationFrame++;

    if (state.animationFrame >= ANIMATION_FRAMES) {
      // Animation complete
      state.animating = false;
      state.animationDirection = null;
      render(); // Full clean render
      return;
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
      previewH,
    );
    process.stdout.write(out);

    setTimeout(tick, ANIMATION_FRAME_MS);
  };

  setTimeout(tick, ANIMATION_FRAME_MS);
}

// ── Window swap animation constants (exported for test/debug-swap-animation.ts) ─
export const WINDOW_SWAP_FRAMES = 8;
export const WINDOW_SWAP_FRAME_MS = 25; // 8 frames * 25ms = 200ms total
export const WINDOW_BOX_WIDTH = 17; // Inner width for window names

function startWindowSwapAnimation(
  fromIndex: number,
  toIndex: number,
  direction: AnimationDirection,
): void {
  state.windowSwapAnimating = true;
  state.windowSwapDirection = direction;
  state.windowSwapFrame = 0;
  state.windowSwapFromIndex = fromIndex;
  state.windowSwapToIndex = toIndex;

  const tick = () => {
    state.windowSwapFrame++;

    if (state.windowSwapFrame >= WINDOW_SWAP_FRAMES) {
      // Animation complete - now perform the actual swap
      state.windowSwapAnimating = false;
      state.windowSwapDirection = null;

      // Perform the tmux swap
      const fromWindow = state.windows[fromIndex];
      const toWindow = state.windows[toIndex];
      try {
        execFileSync("tmux", [
          "swap-window",
          "-d",
          "-s",
          `:${fromWindow.index}`,
          "-t",
          `:${toWindow.index}`,
        ]);
        // Renumber windows to eliminate gaps after swap
        renumberWindows();
        // Refresh window list
        state.windows = getWindows();
        // Update carousel to follow the swapped window
        state.carouselIndex = toIndex;
        state.currentWindowIndex = toIndex;
      } catch {
        // Ignore errors
      }
      render();
      return;
    }

    // Render animation frame
    render();
    setTimeout(tick, WINDOW_SWAP_FRAME_MS);
  };

  setTimeout(tick, WINDOW_SWAP_FRAME_MS);
}

// ── Main render ────────────────────────────────────────────────────────────
function render(): void {
  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;

  let out = ansi.clear;

  // Window carousel (6 rows tall with gray box outline, 2 content lines per box)
  const windowFocused = state.focus === "carousel";

  // Build the 4-row carousel content (each window/button is a bordered box with 2 content lines)
  // Note: WINDOW_BOX_WIDTH is a module-level constant

  // Build arrays for each row of the carousel content
  const row0Parts: string[] = []; // Top borders
  const row1Parts: string[] = []; // Content line 1
  const row2Parts: string[] = []; // Content line 2
  const row3Parts: string[] = []; // Bottom borders

  // Helper to build a box element (returns 4 rows for 2-line content)
  // Selected items use double-line borders (bright/white), non-selected use single-line (dim/gray)
  // windowNumber is optional 1-indexed number to show as superscript in top-right corner
  // isRed renders with red styling for delete confirmation
  const buildBox = (
    lines: [string, string], // Two content lines
    innerWidth: number,
    isSelected: boolean,
    isDim: boolean = false,
    windowNumber?: number,
    isRed: boolean = false,
  ): [string, string, string, string] => {
    // Choose border characters based on selection state
    const tl = isSelected ? box.dtl : box.tl;
    const tr = isSelected ? box.dtr : box.tr;
    const bl = isSelected ? box.dbl : box.bl;
    const br = isSelected ? box.dbr : box.br;
    const h = isSelected ? box.dh : box.h;
    const v = isSelected ? box.dv : box.v;

    let topBorder: string;
    if (windowNumber !== undefined && windowNumber >= 0 && windowNumber <= 9) {
      // Superscript replaces one horizontal char (no width compensation needed)
      topBorder =
        tl + h.repeat(innerWidth - 1) + superscript[windowNumber] + tr;
    } else {
      topBorder = tl + h.repeat(innerWidth) + tr;
    }
    const bottomBorder = bl + h.repeat(innerWidth) + br;

    // Center each content line within innerWidth
    const centerContent = (content: string): string => {
      if (content.length < innerWidth) {
        const totalPadding = innerWidth - content.length;
        const leftPad = Math.floor(totalPadding / 2);
        const rightPad = totalPadding - leftPad;
        return " ".repeat(leftPad) + content + " ".repeat(rightPad);
      }
      return content.slice(0, innerWidth);
    };

    const middleRow1 = v + centerContent(lines[0]) + v;
    const middleRow2 = v + centerContent(lines[1]) + v;

    if (isRed) {
      // Red styling for delete confirmation
      return [
        ansi.red + topBorder + ansi.reset,
        ansi.red + middleRow1 + ansi.reset,
        ansi.red + middleRow2 + ansi.reset,
        ansi.red + bottomBorder + ansi.reset,
      ];
    } else if (isSelected) {
      // Selected: bright white double-line borders
      return [
        ansi.white + topBorder + ansi.reset,
        ansi.white + middleRow1 + ansi.reset,
        ansi.white + middleRow2 + ansi.reset,
        ansi.white + bottomBorder + ansi.reset,
      ];
    } else if (isDim) {
      // Dim: gray single-line borders
      return [
        ansi.dim + topBorder + ansi.reset,
        ansi.dim + middleRow1 + ansi.reset,
        ansi.dim + middleRow2 + ansi.reset,
        ansi.dim + bottomBorder + ansi.reset,
      ];
    }
    // Default: normal single-line borders
    return [topBorder, middleRow1, middleRow2, bottomBorder];
  };

  // Window items (two lines: repo name on line 1, branch/path + indicator on line 2)
  // During swap animation, we render windows in swapped order based on animation progress
  const windowBoxes: [string, string, string, string][] = [];

  for (let i = 0; i < state.windows.length; i++) {
    const win = state.windows[i];
    const isSelected = windowFocused && state.carouselIndex === i;
    const isCurrent = i === state.currentWindowIndex;
    const isConfirmingThisWindow = state.confirmingDelete && isCurrent;

    // Pass window number for superscript (1-indexed, 1-9 only)
    const windowNum = i < 9 ? i + 1 : undefined;

    if (isConfirmingThisWindow) {
      // Show delete confirmation inline in this window's box
      windowBoxes.push(
        buildBox(
          ["Delete?", "[⏎] yes [esc]"],
          WINDOW_BOX_WIDTH,
          true,
          false,
          windowNum,
          true,
        ),
      );
    } else {
      const [line1, line2] = splitWindowName(win.name);
      // Add current indicator to line 2 (or line 1 if line 2 is empty)
      let displayLine1 = line1;
      let displayLine2 = line2;
      if (isCurrent) {
        if (line2) {
          displayLine2 += " ●";
        } else {
          displayLine1 += " ●";
        }
      }

      windowBoxes.push(
        buildBox(
          [displayLine1, displayLine2],
          WINDOW_BOX_WIDTH,
          isSelected,
          false,
          windowNum,
        ),
      );
    }
  }

  // During swap animation, render the two swapping windows as a combined "swap zone"
  // The swap zone has constant width = box1Width + gap + box2Width
  // Both windows slide within this zone, trading positions without clipping
  let swapZoneFromIdx = -1;
  let swapZoneToIdx = -1;
  let swapZoneRows: [string, string, string, string] | null = null;

  if (
    state.windowSwapAnimating &&
    state.windowSwapFromIndex >= 0 &&
    state.windowSwapToIndex >= 0
  ) {
    const fromIdx = state.windowSwapFromIndex;
    const toIdx = state.windowSwapToIndex;
    if (fromIdx < windowBoxes.length && toIdx < windowBoxes.length) {
      // Calculate animation progress with ease-out
      const rawProgress = state.windowSwapFrame / WINDOW_SWAP_FRAMES;
      const progress = easeOut(rawProgress);

      // Box width = inner + 2 borders
      const boxWidth = WINDOW_BOX_WIDTH + 2; // 19 chars
      const gap = 1; // Gap between boxes

      // Swap zone width = two boxes + gap between them
      const zoneWidth = boxWidth + gap + boxWidth; // 39 chars

      // Get the boxes (ensure left box comes first)
      const leftIdx = Math.min(fromIdx, toIdx);
      const rightIdx = Math.max(fromIdx, toIdx);
      const leftBox = windowBoxes[leftIdx];
      const rightBox = windowBoxes[rightIdx];

      // Determine which box is moving right (the "from" box)
      const leftIsMovingRight = fromIdx === leftIdx;

      // Calculate positions within the zone
      // At progress 0: left box at position 0, right box at position (boxWidth + gap)
      // At progress 1: boxes have swapped - left box at (boxWidth + gap), right box at 0
      const leftStart = 0;
      const leftEnd = zoneWidth - boxWidth;
      const rightStart = zoneWidth - boxWidth;
      const rightEnd = 0;

      let leftPos: number;
      let rightPos: number;

      if (leftIsMovingRight) {
        // Left box (from) moves right, right box (to) moves left
        leftPos = Math.round(leftStart + progress * (leftEnd - leftStart));
        rightPos = Math.round(rightStart + progress * (rightEnd - rightStart));
      } else {
        // Right box (from) moves left, left box (to) moves right
        rightPos = Math.round(rightStart + progress * (rightEnd - rightStart));
        leftPos = Math.round(leftStart + progress * (leftEnd - leftStart));
      }

      // Render the swap zone (stripAnsi imported from utils.ts)
      swapZoneRows = leftBox.map((row1, rowIdx) => {
        const row2 = rightBox[rowIdx];

        // Strip ANSI codes to get pure visual characters for buffer manipulation
        const pureRow1 = stripAnsi(row1);
        const pureRow2 = stripAnsi(row2);

        // Create a zone buffer filled with spaces
        const buffer: string[] = new Array(zoneWidth).fill(" ");

        // Place right box first (background if overlapping)
        const chars2 = [...pureRow2];
        for (let i = 0; i < chars2.length && rightPos + i < zoneWidth; i++) {
          if (rightPos + i >= 0) {
            buffer[rightPos + i] = chars2[i];
          }
        }

        // Place left box second (foreground if overlapping - this is the selected box)
        const chars1 = [...pureRow1];
        for (let i = 0; i < chars1.length && leftPos + i < zoneWidth; i++) {
          if (leftPos + i >= 0) {
            buffer[leftPos + i] = chars1[i];
          }
        }

        // Re-apply styling: selected box (left) gets white color
        // The result has the left (selected) box overlaid on the right box
        return ansi.white + buffer.join("") + ansi.reset;
      }) as [string, string, string, string];

      swapZoneFromIdx = leftIdx;
      swapZoneToIdx = rightIdx;
    }
  }

  // Add window boxes to row parts
  // If swap animation is active, replace the two swapping boxes with the swap zone
  for (let i = 0; i < windowBoxes.length; i++) {
    if (swapZoneRows && i === swapZoneFromIdx) {
      // Add the swap zone in place of the first swapping box
      row0Parts.push(swapZoneRows[0]);
      row1Parts.push(swapZoneRows[1]);
      row2Parts.push(swapZoneRows[2]);
      row3Parts.push(swapZoneRows[3]);
    } else if (swapZoneRows && i === swapZoneToIdx) {
    } else {
      // Normal box
      const [t, m1, m2, b] = windowBoxes[i];
      row0Parts.push(t);
      row1Parts.push(m1);
      row2Parts.push(m2);
      row3Parts.push(b);
    }
  }

  // Join with spaces between boxes
  const carouselRow0 = row0Parts.join(" ");
  const carouselRow1 = row1Parts.join(" ");
  const carouselRow2 = row2Parts.join(" ");
  const carouselRow3 = row3Parts.join(" ");

  // Draw the 6-row carousel box with gray outline (2 content lines per box)
  // Use width - 4 so the total rendered width (inner + 2 corners) fits with margin
  const carouselBoxWidth = width - 4;
  const carouselStartX = 1;

  const dimCarousel = !windowFocused;

  // Row 0: Top border of outer box
  out += ansi.moveTo(carouselStartX, 0);
  out +=
    ansi.dim + box.tl + box.h.repeat(carouselBoxWidth) + box.tr + ansi.reset;

  // Row 1: Top borders of inner boxes (with outer side borders)
  out += ansi.moveTo(carouselStartX, 1);
  out += `${ansi.dim + box.v + ansi.reset} ${dimCarousel ? ansi.dim : ""}${carouselRow0}${dimCarousel ? ansi.reset : ""}`;
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 1);
  out += ansi.dim + box.v + ansi.reset;

  // Row 2: Content line 1 of inner boxes (with outer side borders)
  out += ansi.moveTo(carouselStartX, 2);
  out += `${ansi.dim + box.v + ansi.reset} ${dimCarousel ? ansi.dim : ""}${carouselRow1}${dimCarousel ? ansi.reset : ""}`;
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 2);
  out += ansi.dim + box.v + ansi.reset;

  // Row 3: Content line 2 of inner boxes (with outer side borders)
  out += ansi.moveTo(carouselStartX, 3);
  out += `${ansi.dim + box.v + ansi.reset} ${dimCarousel ? ansi.dim : ""}${carouselRow2}${dimCarousel ? ansi.reset : ""}`;
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 3);
  out += ansi.dim + box.v + ansi.reset;

  // Row 4: Bottom borders of inner boxes (with outer side borders)
  out += ansi.moveTo(carouselStartX, 4);
  out += `${ansi.dim + box.v + ansi.reset} ${dimCarousel ? ansi.dim : ""}${carouselRow3}${dimCarousel ? ansi.reset : ""}`;
  out += ansi.moveTo(carouselStartX + carouselBoxWidth + 1, 4);
  out += ansi.dim + box.v + ansi.reset;

  // Row 5: Bottom border of outer box
  out += ansi.moveTo(carouselStartX, 5);
  out +=
    ansi.dim + box.bl + box.h.repeat(carouselBoxWidth) + box.br + ansi.reset;

  // Separator (moved down to row 6)
  out += ansi.moveTo(0, 6) + box.h.repeat(width);

  // Middle section: layout preview (left) + AI summary (right)
  // OR repo picker dialog when in repoPicker mode
  // Constrain to 100 chars max width, centered if terminal is wider
  const maxContentWidth = 100;
  const contentWidth = Math.min(width, maxContentWidth);

  const previewY = 8; // Start after carousel (6 rows) + separator (1 row) + gap (1 row)
  const previewH = Math.min(height - 11, 12);

  const activePicker = state.picker ?? state.branchPicker;
  if (state.focus === "layout") {
    // Layout picker + rename form (shown after Enter on carousel window)
    const layout = ALL_LAYOUTS[state.layoutIndex];
    const previewW = Math.min(40, Math.floor(contentWidth / 2));
    const previewX = Math.floor((width - previewW) / 2);
    out += drawLayoutPreview(layout, previewX, previewY, previewW, previewH);

    const paneCount = layout.panes.length;
    const focusOnPicker = state.layoutField === "picker";
    const counter = `${paneCount} pane${paneCount > 1 ? "s" : ""} · ${state.layoutIndex + 1}/${ALL_LAYOUTS.length}`;
    const counterX = previewX + Math.floor((previewW - counter.length) / 2);
    out += ansi.moveTo(counterX, previewY + previewH);
    if (focusOnPicker) out += ansi.inverse;
    out += ` ${counter} `;
    out += ansi.reset;

    // Rename form below layout preview
    const formY = previewY + previewH + 2;
    const formX = previewX;
    const selectedWindow = state.windows[state.carouselIndex];
    const [repoName, branchName] = splitWindowName(selectedWindow?.name ?? "");

    // Get actual directory path from tmux pane
    let dirPath = "";
    try {
      dirPath = execFileSync("tmux", [
        "display-message",
        "-t",
        `:${selectedWindow?.index ?? 0}`,
        "-p",
        "#{pane_current_path}",
      ])
        .toString()
        .trim();
    } catch {
      /* ignore */
    }

    const fields: { label: string; value: string; field: LayoutField }[] = [
      { label: "directory", value: dirPath, field: "directory" },
      { label: "repo", value: repoName, field: "repo" },
      { label: "branch", value: branchName, field: "branch" },
    ];

    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const isFocused = state.layoutField === f.field;
      out += ansi.moveTo(formX, formY + i);
      if (isFocused) out += ansi.inverse;
      out += ` ${f.label}: ${f.value} `;
      out += ansi.reset;
    }
  } else if (activePicker) {
    // Render typeahead picker centered in the middle section
    const pickerHeight = previewH + 2;
    const pickerLines = renderTypeaheadLines(
      activePicker.typeahead,
      width,
      pickerHeight,
    );

    const boxWidth = Math.min(width - 4, 50);
    const pickerX = Math.floor((width - boxWidth) / 2);

    const dimPicker = state.focus !== "typeahead";
    for (let i = 0; i < pickerLines.length; i++) {
      out += ansi.moveTo(pickerX, previewY + i);
      if (dimPicker) out += ansi.dim;
      out += pickerLines[i];
      if (dimPicker) out += ansi.reset;
    }
  }

  // Separator
  out += ansi.moveTo(0, height - 2) + box.h.repeat(width);

  // Key hints (bottom row)
  let hints: string;
  if (state.focus === "layout") {
    hints = "hl cycle  jk fields  ⏎ apply  esc back";
  } else if (state.focus === "carousel") {
    hints = "hl nav  ⏎ layout  tab typeahead  -x delete";
  } else if (state.typeaheadMode === "branchPicker") {
    hints = "type to filter  jk nav  ⏎ select  ^X delete  esc cancel";
  } else {
    hints = "type to filter  jk nav  ⏎ select  tab carousel";
  }
  out += ansi.moveTo(1, height - 1) + ansi.dim + hints + ansi.reset;

  process.stdout.write(out);
}

// ── Startup window rename ───────────────────────────────────────────────────

/**
 * Rename all windows on startup using 15-char heuristic.
 * Runs async so it doesn't block the initial UI render.
 */
async function renameWindowsOnStartup(): Promise<void> {
  try {
    const { renameAllWindows } = await import("./window-naming");
    const count = await renameAllWindows();
    log(`[cmux] Startup renamed ${count} window(s)`);

    // Refresh window list to show updated names
    state.windows = getWindows();
    render();
  } catch (e) {
    log("[cmux] Startup rename failed:", e);
  }
}

// ── Input handling ─────────────────────────────────────────────────────────

function handleKey(key: string): boolean {
  // Normalize arrow keys
  let normalizedKey = key;
  if (key === "\x1b[A") normalizedKey = "k";
  else if (key === "\x1b[B") normalizedKey = "j";
  else if (key === "\x1b[C") normalizedKey = "l";
  else if (key === "\x1b[D") normalizedKey = "h";
  // Ctrl+N/Ctrl+P synonyms for j/k
  if (key === "\x0e") normalizedKey = "j";
  if (key === "\x10") normalizedKey = "k";

  // q always quits
  if (normalizedKey === "q" && state.focus !== "typeahead") return false;

  // Tab toggles between typeahead and carousel
  if (normalizedKey === "\t") {
    if (state.focus === "typeahead") {
      state.focus = "carousel";
    } else {
      state.focus = "typeahead";
      if (!state.picker)
        state.picker = initRepoPicker(
          state.windows,
          getSelectedCarouselCwd(),
        );
      else refreshPickerCwd();
    }
    state.confirmingDelete = false;
    return true;
  }

  // Dispatch by focus
  switch (state.focus) {
    case "typeahead":
      return handleTypeaheadFocus(key);
    case "carousel":
      return handleCarouselFocus(normalizedKey);
    case "layout":
      return handleLayoutFocus(normalizedKey);
  }
}

function handleTypeaheadFocus(key: string): boolean {
  // Up/Ctrl+P at top of list → move focus to carousel
  const isUp = key === "\x1b[A" || key === "\x10";
  if (isUp) {
    const picker = state.picker ?? state.branchPicker;
    if (picker && picker.typeahead.selectedIndex === 0) {
      state.focus = "carousel";
      return true;
    }
  }

  if (state.typeaheadMode === "branchPicker") {
    return handleBranchPickerMode(key);
  }
  return handlePickerMode(key);
}

function handleCarouselFocus(key: string): boolean {
  const maxCarouselIndex = state.windows.length - 1;

  // During window swap animation, ignore navigation
  if (state.windowSwapAnimating && (key === "h" || key === "l")) {
    return true;
  }

  switch (key) {
    case "j": // Down/Ctrl+N from carousel → typeahead
      state.focus = "typeahead";
      if (!state.picker)
        state.picker = initRepoPicker(state.windows, getSelectedCarouselCwd());
      else refreshPickerCwd();
      return true;
    case "h":
      if (state.carouselIndex > 0) {
        state.carouselIndex--;
        state.confirmingDelete = false;
        updateLayoutForSelectedWindow();
        refreshPickerCwd();
      }
      return true;
    case "l":
      if (state.carouselIndex < maxCarouselIndex) {
        state.carouselIndex++;
        state.confirmingDelete = false;
        updateLayoutForSelectedWindow();
        refreshPickerCwd();
      }
      return true;
    case "\r":
    case " ":
      if (state.confirmingDelete) {
        removeCurrentWindow();
        return false;
      }
      if (state.carouselIndex === state.currentWindowIndex) {
        // Enter on current window → layout picker
        state.focus = "layout";
        state.layoutField = "picker";
        updateLayoutForSelectedWindow();
        return true;
      } else {
        // Enter on different window → switch to it and exit
        const selectedWindow = state.windows[state.carouselIndex];
        if (selectedWindow) {
          try {
            execFileSync("tmux", [
              "select-window",
              "-t",
              `:${selectedWindow.index}`,
            ]);
          } catch {
            /* ignore */
          }
        }
        return false;
      }
    case "\x1b": // Escape
      if (state.confirmingDelete) {
        state.confirmingDelete = false;
        return true;
      }
      // Escape from carousel → back to typeahead
      state.focus = "typeahead";
      if (!state.picker)
        state.picker = initRepoPicker(state.windows, getSelectedCarouselCwd());
      else refreshPickerCwd();
      return true;
    case "-":
    case "x":
      if (state.confirmingDelete) {
        removeCurrentWindow();
        return false;
      } else if (state.windows.length > 1) {
        state.confirmingDelete = true;
      }
      return true;
    case "\x1bh": // Alt+h - move window left
      if (!state.windowSwapAnimating) {
        const currentIdx = state.carouselIndex;
        if (currentIdx > 0) {
          startWindowSwapAnimation(currentIdx, currentIdx - 1, "left");
        }
      }
      return true;
    case "\x1bl": // Alt+l - move window right
      if (!state.windowSwapAnimating) {
        const currentIdx = state.carouselIndex;
        if (currentIdx < state.windows.length - 1) {
          startWindowSwapAnimation(currentIdx, currentIdx + 1, "right");
        }
      }
      return true;
    case "1":
    case "2":
    case "3":
    case "4":
    case "5":
    case "6":
    case "7":
    case "8":
    case "9": {
      const windowIndex = parseInt(key, 10) - 1;
      if (windowIndex < state.windows.length) {
        if (windowIndex === state.currentWindowIndex) {
          // Number key on current window → layout picker
          state.carouselIndex = windowIndex;
          state.focus = "layout";
          state.layoutField = "picker";
          updateLayoutForSelectedWindow();
        } else {
          // Number key on different window → switch and exit
          const win = state.windows[windowIndex];
          try {
            execFileSync("tmux", ["select-window", "-t", `:${win.index}`]);
          } catch {
            /* ignore */
          }
          return false;
        }
      }
      return true;
    }
  }
  return true;
}

function handleLayoutFocus(key: string): boolean {
  const layoutFields: LayoutField[] = ["picker", "directory", "repo", "branch"];
  const currentFieldIdx = layoutFields.indexOf(state.layoutField);

  // During layout animation, ignore nav keys
  if (state.animating && (key === "h" || key === "l")) {
    return true;
  }

  switch (key) {
    case "h":
      if (state.layoutField === "picker") {
        state.previousLayoutIndex = state.layoutIndex;
        state.layoutIndex =
          (state.layoutIndex - 1 + ALL_LAYOUTS.length) % ALL_LAYOUTS.length;
        startAnimation("left");
        return true;
      }
      break;
    case "l":
      if (state.layoutField === "picker") {
        state.previousLayoutIndex = state.layoutIndex;
        state.layoutIndex = (state.layoutIndex + 1) % ALL_LAYOUTS.length;
        startAnimation("right");
        return true;
      }
      break;
    case "j": // Down — next field
      if (currentFieldIdx < layoutFields.length - 1) {
        state.layoutField = layoutFields[currentFieldIdx + 1];
      }
      return true;
    case "k": // Up — previous field
      if (currentFieldIdx > 0) {
        state.layoutField = layoutFields[currentFieldIdx - 1];
      }
      return true;
    case "\r":
    case " ":
      // Enter — apply layout and exit
      applyAndExit();
      return false;
    case "\x1b": // Escape — back to carousel
      state.focus = "carousel";
      return true;
  }
  return true;
}

function handlePickerMode(key: string): boolean {
  if (!state.picker) {
    state.picker = initRepoPicker(
      state?.windows ?? [],
      getSelectedCarouselCwd(),
    );
    return true;
  }

  const result = handleRepoPickerKey(state.picker, key);

  switch (result.action) {
    case "continue":
      state.picker = result.state;
      break;
    case "cancel":
      return false; // Picker is home state — cancel exits cmux
    case "select":
      // Open branch picker for this repo
      state.picker = null;
      state.branchPicker = initBranchPicker(result.repo.path, result.repo.name);
      state.typeaheadMode = "branchPicker";
      break;
    case "screen":
      // Switch to selected screen
      try {
        execFileSync("tmux", [
          "select-window",
          "-t",
          `:${result.window.index}`,
        ]);
      } catch {
        // Ignore errors
      }
      return false;
    case "command":
      if (result.command === "shell") {
        log("[shell] command selected, starting login shell");
        try {
          const selectedWindow = state.windows[state.carouselIndex];
          let cwd = process.env.HOME || "/";
          if (selectedWindow) {
            try {
              const paneCwd = execFileSync("tmux", [
                "display-message",
                "-t",
                `:${selectedWindow.index}`,
                "-p",
                "#{pane_current_path}",
              ])
                .toString()
                .trim();
              if (paneCwd) cwd = paneCwd;
            } catch {
              /* fall back to HOME */
            }
          }

          cleanup(false);

          const shell = process.env.SHELL || "/bin/zsh";
          const proc = Bun.spawnSync([shell, "-l"], {
            cwd,
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
          });

          process.exit(proc.exitCode ?? 0);
        } catch (e) {
          log(`[shell] error: ${e}`);
        }
      }
      return false;
    case "directory":
      // Create new window at this directory
      state.picker = null;
      createNewWindowAtPath(result.path);
      return false;
  }

  return true;
}

function handleBranchPickerMode(key: string): boolean {
  if (!state.branchPicker) {
    state.typeaheadMode = "picker";
    return true;
  }

  const result = handleBranchPickerKey(state.branchPicker, key);

  switch (result.action) {
    case "continue":
      state.branchPicker = result.state;
      break;
    case "cancel":
      // Go back to repo picker
      state.branchPicker = null;
      state.typeaheadMode = "picker";
      break;
    case "select":
      // Open window at the worktree path
      state.branchPicker = null;
      state.typeaheadMode = "picker";
      createNewWindowAtPath(result.path);
      return false;
    case "create": {
      // Create worktree and open window
      const repoPath = state.branchPicker.repoPath;
      state.branchPicker = null;
      state.typeaheadMode = "picker";
      try {
        // New branch from origin/main
        execFileSync(
          "git",
          [
            "-C",
            repoPath,
            "worktree",
            "add",
            result.path,
            "-b",
            result.branch,
            "origin/main",
          ],
          { timeout: 10000 },
        );
        createNewWindowAtPath(result.path);
      } catch {
        // If branch exists or origin/main doesn't exist, try without -b and start point
        try {
          execFileSync(
            "git",
            ["-C", repoPath, "worktree", "add", result.path, result.branch],
            { timeout: 10000 },
          );
          createNewWindowAtPath(result.path);
        } catch {
          // Failed to create worktree
        }
      }
      return false;
    }
    case "delete": {
      // Delete worktree or branch, then refresh picker
      const repoPath = state.branchPicker.repoPath;
      try {
        if (result.type === "worktree") {
          // Deletes worktree and branch if they share the same name
          deleteWorktree(repoPath, result.path);
        } else {
          execFileSync("git", ["-C", repoPath, "branch", "-d", result.branch], {
            timeout: 10000,
          });
        }
      } catch {
        // Force delete branch if normal delete fails
        if (result.type !== "worktree") {
          try {
            execFileSync(
              "git",
              ["-C", repoPath, "branch", "-D", result.branch],
              { timeout: 10000 },
            );
          } catch {
            // Failed to delete
          }
        }
      }
      // Refresh the branch picker (preserve repo name)
      const repoName = state.branchPicker?.repoName;
      state.branchPicker = initBranchPicker(repoPath, repoName);
      break;
    }
  }

  return true;
}

function createNewWindowAtPath(targetPath: string): void {
  log("createNewWindowAtPath called with:", targetPath);
  try {
    // Create the new window at the target path (always starts with 1 pane)
    execFileSync("tmux", ["new-window", "-c", targetPath]);
    log("tmux new-window succeeded");

    // Track the repo if it's a git repository
    const tracked = trackRepo(targetPath);
    if (tracked) {
      log("trackRepo added:", tracked.name, "at", tracked.path);
    } else {
      log("trackRepo: not a git repo or no remote");
    }
  } catch (e) {
    log("tmux new-window failed:", e);
  }
}

function removeCurrentWindow(): void {
  if (state.windows.length <= 1) return; // Don't remove last window
  try {
    const windowToDelete = state.windows[state.currentWindowIndex];
    execFileSync("tmux", ["kill-window", "-t", `:${windowToDelete.index}`]);
    // Renumber windows to eliminate gaps after deletion
    renumberWindows();
  } catch (_e) {
    // Ignore errors
  }
}

function applyAndExit(): void {
  const layout = ALL_LAYOUTS[state.layoutIndex];
  const targetWindow = state.windows[state.currentWindowIndex];

  // Record the layout transition (from detected layout to chosen layout)
  try {
    const windowInfo = getWindowInfoForWindow(targetWindow.index);
    const fromIdx = findBestMatchingLayout(
      windowInfo.width,
      windowInfo.height,
      windowInfo.panes,
    );
    const fromLayout = ALL_LAYOUTS[fromIdx];
    if (fromLayout && layout && fromLayout.name !== layout.name) {
      recordTransition(fromLayout.name, layout.name);
    }
  } catch {
    // Ignore errors recording transition
  }

  try {
    // Get current pane's working directory for new splits
    const currentPath = execFileSync("tmux", [
      "display-message",
      "-p",
      "#{pane_current_path}",
    ])
      .toString()
      .trim();

    // Switch to target window if different
    if (!targetWindow.active) {
      execFileSync("tmux", ["select-window", "-t", `:${targetWindow.index}`]);
    }

    // 1. Get current window info
    const windowInfo = getWindowInfo();
    const currentPanes: Pane[] = windowInfo.panes.map((p) => ({
      id: p.id,
      x: p.left,
      y: p.top,
      width: p.width,
      height: p.height,
    }));

    log(
      `[layout] Applying "${layout.name}" (${layout.panes.length} panes) to window with ${currentPanes.length} panes`,
    );
    log(
      `[layout] Current panes:`,
      currentPanes.map(
        (p) => `${p.id} at (${p.x},${p.y}) ${p.width}x${p.height}`,
      ),
    );

    // 2. Resolve target layout to absolute coordinates
    const resolved = resolveLayout(layout, windowInfo.width, windowInfo.height);
    const slots: Slot[] = resolved.map((r) => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    }));

    log(
      `[layout] Target slots:`,
      slots.map((s, i) => `slot${i} at (${s.x},${s.y}) ${s.width}x${s.height}`),
    );

    // 3. Match panes to slots by position
    const { matches, unmatchedSlots, unmatchedPanes } = matchPanesToSlots(
      currentPanes,
      slots,
    );

    log(
      `[layout] Matches:`,
      matches.map(
        (m) => `${m.paneId} -> slot${m.slotIndex} (score: ${m.score})`,
      ),
    );
    log(`[layout] Unmatched slots (need new panes):`, unmatchedSlots);
    log(`[layout] Unmatched panes (will be killed):`, unmatchedPanes);

    // 4. Create new panes for unmatched slots (need more panes)
    for (const _slotIndex of unmatchedSlots) {
      const args = ["split-window"];
      if (currentPath) {
        args.push("-c", currentPath);
      }
      execFileSync("tmux", args);
    }

    // 5. Compute and execute swap sequence to reorder panes
    // Re-fetch pane info after creates to get the new pane order
    const afterCreates = getWindowInfo();
    const currentOrder = afterCreates.panes.map((p) => p.id);

    // Build desired order: for each slot (in order), which pane should be there?
    // matched panes go to their matched slots, new panes fill unmatched slots
    const desiredOrder: string[] = new Array(slots.length);

    // Place matched panes
    for (const match of matches) {
      desiredOrder[match.slotIndex] = match.paneId;
    }

    // Identify newly created panes (IDs not in original matches)
    const matchedPaneIds = new Set(matches.map((m) => m.paneId));
    const newPaneIds = currentOrder.filter(
      (id) => !matchedPaneIds.has(id) && !unmatchedPanes.includes(id),
    );

    // Place new panes into unmatched slots
    for (let i = 0; i < unmatchedSlots.length; i++) {
      const slotIndex = unmatchedSlots[i];
      const newPaneId = newPaneIds[i];
      if (newPaneId) {
        desiredOrder[slotIndex] = newPaneId;
      }
    }

    // Filter out undefined slots and panes that will be killed
    const filteredCurrentOrder = currentOrder.filter(
      (id) => !unmatchedPanes.includes(id),
    );
    const filteredDesiredOrder = desiredOrder.filter((id) => id !== undefined);

    log(`[layout] After creates - current order:`, currentOrder);
    log(`[layout] Desired order:`, desiredOrder);
    log(`[layout] New pane IDs:`, newPaneIds);

    // Execute swaps if needed
    if (
      filteredCurrentOrder.length === filteredDesiredOrder.length &&
      filteredCurrentOrder.length > 0
    ) {
      const swaps = computeSwaps(filteredCurrentOrder, filteredDesiredOrder);
      log(`[layout] Swaps to execute:`, swaps);
      if (swaps.length > 0) {
        executeSwaps(`:${targetWindow.index}`, swaps);
      }
    }

    // 6. Kill unmatched panes AFTER swaps (excess panes)
    for (const paneId of unmatchedPanes) {
      execFileSync("tmux", ["kill-pane", "-t", paneId]);
    }

    // 7. Re-fetch pane info and apply final layout geometry
    const finalInfo = getWindowInfo();
    const finalResolved = resolveLayout(
      layout,
      finalInfo.width,
      finalInfo.height,
    );

    // Generate tmux layout string
    const finalPanes = finalResolved.map((r, i) => ({
      id: finalInfo.panes[i]?.id || `%${i}`,
      ...r,
    }));
    const layoutString = generateLayoutString(
      finalPanes,
      finalInfo.width,
      finalInfo.height,
    );

    // Apply the layout
    execFileSync("tmux", ["select-layout", layoutString]);
    log(`[layout] Applied layout successfully`);
  } catch (e) {
    log(`[layout] Error applying layout:`, e);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

const SESSION_NAME = "cmux";

function sessionExists(): boolean {
  const result = spawnSync("tmux", ["has-session", "-t", SESSION_NAME], {
    stdio: "ignore",
  });
  return result.status === 0;
}

/**
 * Output a shell command to start or attach to tmux session.
 * Called when run outside tmux - the wrapper script evals this output.
 */
function outputTmuxCommand(): void {
  // If session already exists, just attach to it
  if (sessionExists()) {
    console.log(`exec tmux attach -t ${SESSION_NAME}`);
    return;
  }

  // Build popup command with process substitution for prefetched tmux data
  const popupCmd = `bun ${SELF_PATH} <(${STARTUP_COMMAND})`;

  // Escape single quotes in paths for shell safety
  const safeConfigPath = CONFIG_PATH.replace(/'/g, "'\\''");

  // Popup needs bash for process substitution (<(...))
  console.log(
    `exec tmux -f '${safeConfigPath}' new-session -s ${SESSION_NAME} \\; ` +
      `bind -n M-Space display-popup -w 80% -h 80% -E 'bash -c "'"${popupCmd}"'"'`,
  );
}

/**
 * Install cmux wrapper script to ~/.local/bin
 */
function install(): void {
  const home = process.env.HOME;
  if (!home) {
    console.error("error: HOME environment variable not set");
    process.exit(1);
  }

  const binDir = join(home, ".local", "bin");
  const scriptPath = join(binDir, "cmux");

  // Create ~/.local/bin if it doesn't exist
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
    console.log(`created ${binDir}`);
  }

  // Write the wrapper script (process substitution prefetches tmux data in parallel with bun startup)
  const script = `#!/bin/bash
eval "$(bun ${SELF_PATH} <(${STARTUP_COMMAND}))"
`;

  writeFileSync(scriptPath, script);
  chmodSync(scriptPath, 0o755);

  console.log(`installed ${scriptPath}`);

  console.log("");
  console.log("make sure ~/.local/bin is in your PATH:");
  console.log('  export PATH="$HOME/.local/bin:$PATH"');
}

function runUI(): void {
  if (BENCHMARK_MODE) {
    console.error(
      `module load: ${(performance.now() - _startTime).toFixed(1)}ms`,
    );
  }

  if (!BENCHMARK_MODE && !process.stdin.isTTY) {
    console.error("Not a TTY");
    process.exit(1);
  }

  // Switch to alt-screen immediately for instant visual feedback
  if (!BENCHMARK_MODE) {
    process.stdout.write(ansi.altScreen + ansi.hideCursor);
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  // Initialize state after alt-screen switch (includes tmux queries)
  profile("initState", () => {
    state = initState();
  });

  initLog();
  log("[cmux] runUI starting");

  profile("render", () => {
    render();
  });

  // Benchmark mode: exit immediately after first render
  if (BENCHMARK_MODE) {
    console.error(`total: ${(performance.now() - _startTime).toFixed(1)}ms`);
    process.exit(0);
  }

  // Initialize picker after first render (deferred for faster startup)
  state.picker = initRepoPicker(state.windows, getSelectedCarouselCwd());
  render();

  startPolling();

  // Rename windows immediately on startup (async, doesn't block UI)
  renameWindowsOnStartup();

  // Collect repos from current windows (for repo picker)
  collectReposFromWindows();

  process.stdin.on("data", (data) => {
    const input = data.toString();

    // Parse input into key sequences
    // Arrow keys send: \x1b[A (up), \x1b[B (down), \x1b[C (right), \x1b[D (left)
    let i = 0;
    while (i < input.length) {
      let key: string;

      // Check for escape sequences
      if (input[i] === "\x1b" && i + 1 < input.length) {
        if (input[i + 1] === "[") {
          // Arrow key sequences: ESC [ A/B/C/D
          const arrowChar = input[i + 2];
          if (
            arrowChar === "A" ||
            arrowChar === "B" ||
            arrowChar === "C" ||
            arrowChar === "D"
          ) {
            // Pass arrow key escape sequence through as-is
            // handleKey() will convert arrow keys to hjkl
            key = input.slice(i, i + 3);
            i += 3;
          } else {
            // Unknown escape sequence, treat as regular escape
            key = input[i];
            i++;
          }
        } else if (input[i + 1] !== "[") {
          // Alt+key sequences: ESC followed by letter (no bracket)
          // e.g., Alt+h = "\x1bh", Alt+l = "\x1bl"
          key = input.slice(i, i + 2);
          i += 2;
        } else {
          key = input[i];
          i++;
        }
      } else {
        key = input[i];
        i++;
      }

      if (!handleKey(key)) {
        cleanup();
        return;
      }
    }
    render();
  });
}

function main(): void {
  const args = process.argv.slice(2);

  // Handle --install flag
  if (args.includes("--install")) {
    install();
    return;
  }

  // Outside tmux: output shell command for wrapper to eval
  if (!isInsideTmux()) {
    outputTmuxCommand();
    return;
  }

  // Inside tmux: run the UI
  runUI();
}

function cleanup(exit: boolean = true) {
  stopPolling();
  process.stdout.write(ansi.showCursor + ansi.exitAltScreen);
  process.stdin.setRawMode(false);

  // Close shared database connection and checkpoint WAL before exiting
  closeDb();

  if (exit) process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

main();
