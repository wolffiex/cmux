#!/usr/bin/env bun
/**
 * Background process that periodically renames tmux windows with AI-generated summaries.
 * Spawned by cmux when starting a tmux session.
 */

import { execSync } from "node:child_process";
import { getWindows, getWindowContext, type TmuxWindow } from "./tmux";
import { getSummariesForWindows } from "./summaries";
import { initLog, log } from "./logger";

const RENAME_INTERVAL_MS = 150_000; // 2.5 minutes

/**
 * Sanitize summary text for use as tmux window name
 * @param summary - AI-generated window name
 * @param maxLength - Maximum length (default 12 for windows, 15 for sessions)
 */
function sanitizeWindowName(summary: string, maxLength: number = 12): string {
  let name = summary
    .replace(/["'`$\\]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();

  // If already under limit, return as-is
  if (name.length <= maxLength) {
    return name;
  }

  // Truncate and find the last complete word boundary
  name = name.slice(0, maxLength);

  // Remove trailing hyphens and partial words
  // Find last space or hyphen and truncate there
  const lastSpace = name.lastIndexOf(" ");
  const lastHyphen = name.lastIndexOf("-");
  const boundary = Math.max(lastSpace, lastHyphen);

  if (boundary > 0 && boundary < name.length - 1) {
    // There's content after the boundary, meaning we cut mid-word
    name = name.slice(0, boundary);
  }

  // Clean up any trailing punctuation or hyphens
  name = name.replace(/[-_:;,.\s]+$/, "").trim();

  return name;
}

/**
 * Rename windows with their AI-generated summaries
 */
async function renameWindows(summaries: Map<number, string>): Promise<void> {
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
 * Perform one cycle of fetching summaries and renaming windows
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

    // Get AI summaries
    const summaries = await getSummariesForWindows(contexts);

    // Rename windows
    await renameWindows(summaries);

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
