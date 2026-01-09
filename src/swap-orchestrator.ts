/**
 * Swap orchestrator for reordering panes in a tmux window.
 *
 * Uses a selection sort approach to compute the minimal sequence of swaps
 * needed to transform the current pane order into the desired order.
 * This guarantees at most N-1 swaps for N panes.
 */

import { execSync } from "node:child_process";

export interface SwapCommand {
  fromIndex: number;
  toIndex: number;
}

/**
 * Compute the sequence of swaps needed to reorder panes.
 * Uses selection sort approach - at most N-1 swaps.
 *
 * @param currentOrder - pane IDs in current index order ["%0", "%2", "%1"]
 * @param desiredOrder - pane IDs in desired index order ["%1", "%2", "%0"]
 * @returns array of swap commands to execute
 */
export function computeSwaps(
  currentOrder: string[],
  desiredOrder: string[]
): SwapCommand[] {
  if (currentOrder.length !== desiredOrder.length) {
    throw new Error(
      `Order arrays must have same length: current=${currentOrder.length}, desired=${desiredOrder.length}`
    );
  }

  if (currentOrder.length === 0) {
    return [];
  }

  // Validate that both arrays contain the same set of pane IDs
  const currentSet = new Set(currentOrder);
  const desiredSet = new Set(desiredOrder);

  if (currentSet.size !== currentOrder.length) {
    throw new Error("Current order contains duplicate pane IDs");
  }

  if (desiredSet.size !== desiredOrder.length) {
    throw new Error("Desired order contains duplicate pane IDs");
  }

  // Work with a copy so we don't mutate the input
  const working = [...currentOrder];
  const swaps: SwapCommand[] = [];

  // Selection sort approach: for each position, find the element that should be
  // there and swap it into place
  for (let targetIndex = 0; targetIndex < working.length; targetIndex++) {
    const desiredPaneId = desiredOrder[targetIndex];

    // Find where the desired pane currently is
    const currentIndex = working.indexOf(desiredPaneId);

    if (currentIndex === -1) {
      throw new Error(
        `Pane ID "${desiredPaneId}" from desired order not found in current order`
      );
    }

    // If it's not already in the right place, swap it there
    if (currentIndex !== targetIndex) {
      swaps.push({
        fromIndex: currentIndex,
        toIndex: targetIndex,
      });

      // Update working array to reflect the swap
      const temp = working[targetIndex];
      working[targetIndex] = working[currentIndex];
      working[currentIndex] = temp;
    }
  }

  return swaps;
}

/**
 * Execute swap commands via tmux.
 *
 * @param windowTarget - tmux window target (e.g., "0" or "session:window")
 * @param swaps - swap commands from computeSwaps
 */
export function executeSwaps(windowTarget: string, swaps: SwapCommand[]): void {
  for (const swap of swaps) {
    // tmux swap-pane uses -s (source) and -t (target) pane indices
    // We need to reference panes within the window: windowTarget.paneIndex
    const sourcePane = `${windowTarget}.${swap.fromIndex}`;
    const targetPane = `${windowTarget}.${swap.toIndex}`;

    execSync(`tmux swap-pane -s '${sourcePane}' -t '${targetPane}'`);
  }
}
