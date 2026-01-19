/**
 * Pane matcher - matches existing panes to layout slots based on position.
 *
 * Uses overlap area as the primary matching metric, with center-point distance
 * as a fallback when panes don't overlap (e.g., switching from horizontal to vertical).
 *
 * The algorithm uses greedy matching: for each slot, pick the best unmatched pane.
 * This is O(n*m) but sufficient for typical pane counts (1-4 panes).
 */

export interface Pane {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Slot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MatchResult {
  matches: Array<{ paneId: string; slotIndex: number; score: number }>;
  unmatchedSlots: number[]; // Need new panes
  unmatchedPanes: string[]; // Will be killed
}

/**
 * Calculate overlap area between pane and slot.
 * Returns 0 if no overlap.
 */
export function calculateOverlap(pane: Pane, slot: Slot): number {
  const xOverlap = Math.max(
    0,
    Math.min(pane.x + pane.width, slot.x + slot.width) -
      Math.max(pane.x, slot.x),
  );
  const yOverlap = Math.max(
    0,
    Math.min(pane.y + pane.height, slot.y + slot.height) -
      Math.max(pane.y, slot.y),
  );
  return xOverlap * yOverlap;
}

/**
 * Calculate center-point Euclidean distance between pane and slot.
 * Used as fallback when there's no overlap.
 */
export function centerDistance(pane: Pane, slot: Slot): number {
  const paneCenterX = pane.x + pane.width / 2;
  const paneCenterY = pane.y + pane.height / 2;
  const slotCenterX = slot.x + slot.width / 2;
  const slotCenterY = slot.y + slot.height / 2;

  const dx = paneCenterX - slotCenterX;
  const dy = paneCenterY - slotCenterY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate a composite score for matching a pane to a slot.
 * Higher scores indicate better matches.
 *
 * Strategy:
 * - If there's overlap, use overlap area as score (larger = better)
 * - If no overlap, use negative distance (closer = less negative = better)
 * - Multiply by a top-bias factor so existing panes prefer top slots
 *   when a pane spans multiple vertically-stacked slots
 *   (this ensures new panes appear at the bottom)
 */
function calculateMatchScore(
  pane: Pane,
  slot: Slot,
  topBiasMultiplier: number = 1,
): number {
  const overlap = calculateOverlap(pane, slot);

  if (overlap > 0) {
    // Multiply overlap by top-bias factor (1.0 to ~1.2 for top slots)
    return overlap * topBiasMultiplier;
  }
  // No overlap: use negative distance so closer panes score higher
  // Add a small offset to ensure all distance-based scores are negative
  // Apply top-bias as additive bonus (small compared to distance magnitude)
  return -centerDistance(pane, slot) - 1 + (topBiasMultiplier - 1) * 100;
}

/**
 * Match panes to slots using greedy algorithm.
 *
 * For each slot (in order), find the best unmatched pane.
 * Returns matches, plus lists of unmatched slots and panes.
 */
export function matchPanesToSlots(panes: Pane[], slots: Slot[]): MatchResult {
  const matches: Array<{ paneId: string; slotIndex: number; score: number }> =
    [];
  const matchedPaneIds = new Set<string>();
  const matchedSlotIndices = new Set<number>();

  // Calculate max Y to normalize top-bias (slots at top get higher multiplier)
  const maxY = slots.length > 0 ? Math.max(...slots.map((s) => s.y)) : 0;
  // Top-bias: 20% bonus for top slots. This multiplicative approach ensures
  // that when a pane spans multiple vertically-stacked slots (like a full-height
  // right pane transitioning to top-right + bottom-right), the top slot wins
  // regardless of small height differences between slots.
  const TOP_BIAS_BONUS = 0.2;

  // Build score matrix
  const scores: Array<{ paneId: string; slotIndex: number; score: number }> =
    [];
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    const slot = slots[slotIndex];
    // topBiasMultiplier: 1.0 + bonus for slots with smaller Y (closer to top)
    // Range: [1.0, 1.0 + TOP_BIAS_BONUS] - bottom slots get 1.0, top slots get 1.2
    const topBiasMultiplier =
      1.0 + (maxY > 0 ? TOP_BIAS_BONUS * (1 - slot.y / maxY) : 0);
    for (const pane of panes) {
      scores.push({
        paneId: pane.id,
        slotIndex,
        score: calculateMatchScore(pane, slot, topBiasMultiplier),
      });
    }
  }

  // Sort by score descending (best matches first)
  scores.sort((a, b) => b.score - a.score);

  // Greedy matching: take best available matches
  for (const candidate of scores) {
    if (
      matchedPaneIds.has(candidate.paneId) ||
      matchedSlotIndices.has(candidate.slotIndex)
    ) {
      continue;
    }
    matches.push(candidate);
    matchedPaneIds.add(candidate.paneId);
    matchedSlotIndices.add(candidate.slotIndex);

    // Stop when we've matched as many as possible
    if (matches.length >= Math.min(panes.length, slots.length)) {
      break;
    }
  }

  // Find unmatched slots and panes
  const unmatchedSlots: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    if (!matchedSlotIndices.has(i)) {
      unmatchedSlots.push(i);
    }
  }

  const unmatchedPanes: string[] = [];
  for (const pane of panes) {
    if (!matchedPaneIds.has(pane.id)) {
      unmatchedPanes.push(pane.id);
    }
  }

  return { matches, unmatchedSlots, unmatchedPanes };
}
