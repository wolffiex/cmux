/**
 * Shared utility functions for cmux.
 */

/**
 * Sanitize summary text for use as tmux window name
 * @param summary - AI-generated window name
 * @param maxLength - Maximum length (default 15)
 */
export function sanitizeWindowName(summary: string, maxLength: number = 15): string {
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
