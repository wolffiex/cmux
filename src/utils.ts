/**
 * Shared utility functions for cmux.
 */

/**
 * Strip ANSI escape codes from a string.
 * @param str - String potentially containing ANSI escape codes
 * @returns String with all ANSI escape codes removed
 */
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Quadratic ease-out for smooth animation deceleration.
 * @param t - Progress value from 0 to 1
 * @returns Eased progress value
 */
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 2;
}

/**
 * Truncate a name to 15 characters with ellipsis if needed.
 * Used by the display layer for window names.
 */
export function truncateName(name: string): string {
  if (name.length <= 15) return name;
  return `${name.slice(0, 14)}…`;
}

/**
 * Truncate from front, keeping the END (for branch names).
 * Branch suffixes like "-truncation" are more meaningful than prefixes like "worker-".
 */
function truncateFromFront(name: string, maxLen = 15): string {
  if (name.length <= maxLen) return name;
  return `…${name.slice(-(maxLen - 1))}`;
}

/**
 * Split window name into two lines: [repo/prefix, branch/suffix]
 * If name has "/" - split at first "/" (repo on line 1, rest on line 2)
 * Otherwise - put name on line 1, empty line 2
 */
export function splitWindowName(name: string): [string, string] {
  const slashIndex = name.indexOf("/");
  if (slashIndex > 0 && slashIndex < name.length - 1) {
    const line1 = name.slice(0, slashIndex);
    const line2 = name.slice(slashIndex + 1);
    return [truncateName(line1), truncateFromFront(line2)];
  }
  return [truncateName(name), ""];
}

/**
 * Sanitize summary text for use as tmux window name.
 * Removes special characters that could cause issues with tmux.
 * Display truncation is handled by the UI layer, not here.
 * @param summary - Generated window name
 * @param maxLength - Maximum length (default 50, generous to allow display layer to handle truncation)
 */
export function sanitizeWindowName(
  summary: string,
  maxLength: number = 50,
): string {
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
