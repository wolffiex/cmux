#!/usr/bin/env bun
/**
 * Background process that periodically renames tmux windows based on context.
 * Uses a heuristic approach: repo-name/branch-suffix for feature branches.
 * Spawned by cmux when starting a tmux session.
 */

import { execSync } from "node:child_process";
import { getWindows, getWindowContext } from "./tmux";
import { getSummariesForWindows } from "./summaries";
import { initLog, log } from "./logger";
import { sanitizeWindowName } from "./utils";

const RENAME_INTERVAL_MS = 150_000; // 2.5 minutes

/**
 * Rename windows with their generated names
 */
function renameWindows(summaries: Map<number, string>): void {
  for (const [windowIndex, summary] of summaries) {
    const shortName = sanitizeWindowName(summary);
    if (shortName.length > 0) {
      try {
        execSync(`tmux rename-window -t :${windowIndex} "${shortName}"`);
        log(`[bg-renamer] Renamed window ${windowIndex} to "${shortName}"`);
      } catch (e) {
        log(`[bg-renamer] Failed to rename window ${windowIndex}:`, e);
      }
    }
  }
}

/**
 * Perform one cycle of fetching context and renaming windows
 */
async function updateWindowNames(): Promise<void> {
  try {
    const windows = getWindows();
    if (windows.length === 0) {
      log("[bg-renamer] No windows found");
      return;
    }

    log(`[bg-renamer] Updating ${windows.length} window(s)`);

    // Get contexts for all windows
    const contexts = await Promise.all(
      windows.map((w) => getWindowContext(w.index))
    );

    // Get heuristic-based names (synchronous, no API calls)
    const summaries = getSummariesForWindows(contexts);

    // Rename windows
    renameWindows(summaries);

    log("[bg-renamer] Update cycle complete");
  } catch (e) {
    log("[bg-renamer] Error in update cycle:", e);
  }
}

/**
 * Check if we're still inside a valid tmux session
 */
function isSessionAlive(): boolean {
  try {
    execSync("tmux display-message -p ''", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Main loop - runs until tmux session ends
 */
async function main(): Promise<void> {
  initLog();
  log("[bg-renamer] Starting background window renamer");

  // Initial delay to let the session settle
  await new Promise((resolve) => setTimeout(resolve, 5000));

  while (true) {
    if (!isSessionAlive()) {
      log("[bg-renamer] Session ended, exiting");
      break;
    }

    await updateWindowNames();

    // Wait for next cycle
    await new Promise((resolve) => setTimeout(resolve, RENAME_INTERVAL_MS));
  }
}

main().catch((e) => {
  log("[bg-renamer] Fatal error:", e);
  process.exit(1);
});
