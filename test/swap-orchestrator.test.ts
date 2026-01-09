import { test, expect, describe } from "bun:test";
import { computeSwaps, SwapCommand } from "../src/swap-orchestrator";

/**
 * Helper to apply swaps to an array and verify the result.
 * This simulates what tmux would do.
 */
function applySwaps(order: string[], swaps: SwapCommand[]): string[] {
  const result = [...order];
  for (const swap of swaps) {
    const temp = result[swap.toIndex];
    result[swap.toIndex] = result[swap.fromIndex];
    result[swap.fromIndex] = temp;
  }
  return result;
}

describe("computeSwaps", () => {
  describe("basic cases", () => {
    test("no-op: already in correct order returns empty swaps", () => {
      const current = ["%0", "%1", "%2"];
      const desired = ["%0", "%1", "%2"];
      const swaps = computeSwaps(current, desired);
      expect(swaps).toEqual([]);
    });

    test("simple swap: two elements reversed", () => {
      const current = ["%0", "%1"];
      const desired = ["%1", "%0"];
      const swaps = computeSwaps(current, desired);

      expect(swaps.length).toBe(1);
      expect(swaps[0]).toEqual({ fromIndex: 1, toIndex: 0 });

      // Verify the swaps produce the desired order
      expect(applySwaps(current, swaps)).toEqual(desired);
    });

    test("rotation: [A, B, C] -> [B, C, A]", () => {
      const current = ["%A", "%B", "%C"];
      const desired = ["%B", "%C", "%A"];
      const swaps = computeSwaps(current, desired);

      // Should need at most 2 swaps
      expect(swaps.length).toBeLessThanOrEqual(2);

      // Verify the swaps produce the desired order
      expect(applySwaps(current, swaps)).toEqual(desired);
    });

    test("reverse rotation: [A, B, C] -> [C, A, B]", () => {
      const current = ["%A", "%B", "%C"];
      const desired = ["%C", "%A", "%B"];
      const swaps = computeSwaps(current, desired);

      expect(swaps.length).toBeLessThanOrEqual(2);
      expect(applySwaps(current, swaps)).toEqual(desired);
    });

    test("reversal: [A, B, C] -> [C, B, A]", () => {
      const current = ["%A", "%B", "%C"];
      const desired = ["%C", "%B", "%A"];
      const swaps = computeSwaps(current, desired);

      // Reversal with middle element in place only needs 1 swap (swap ends)
      expect(swaps.length).toBe(1);
      expect(applySwaps(current, swaps)).toEqual(desired);
    });
  });

  describe("complex reorderings", () => {
    test("full reversal: [A, B, C, D] -> [D, C, B, A]", () => {
      const current = ["%A", "%B", "%C", "%D"];
      const desired = ["%D", "%C", "%B", "%A"];
      const swaps = computeSwaps(current, desired);

      // Full reversal should take at most N-1 = 3 swaps
      expect(swaps.length).toBeLessThanOrEqual(3);
      expect(applySwaps(current, swaps)).toEqual(desired);
    });

    test("arbitrary reorder: [A, B, C, D] -> [C, A, D, B]", () => {
      const current = ["%A", "%B", "%C", "%D"];
      const desired = ["%C", "%A", "%D", "%B"];
      const swaps = computeSwaps(current, desired);

      expect(swaps.length).toBeLessThanOrEqual(3);
      expect(applySwaps(current, swaps)).toEqual(desired);
    });

    test("five elements: [1, 2, 3, 4, 5] -> [5, 4, 3, 2, 1]", () => {
      const current = ["%1", "%2", "%3", "%4", "%5"];
      const desired = ["%5", "%4", "%3", "%2", "%1"];
      const swaps = computeSwaps(current, desired);

      expect(swaps.length).toBeLessThanOrEqual(4);
      expect(applySwaps(current, swaps)).toEqual(desired);
    });

    test("move first to last: [A, B, C, D] -> [B, C, D, A]", () => {
      const current = ["%A", "%B", "%C", "%D"];
      const desired = ["%B", "%C", "%D", "%A"];
      const swaps = computeSwaps(current, desired);

      expect(swaps.length).toBeLessThanOrEqual(3);
      expect(applySwaps(current, swaps)).toEqual(desired);
    });

    test("move last to first: [A, B, C, D] -> [D, A, B, C]", () => {
      const current = ["%A", "%B", "%C", "%D"];
      const desired = ["%D", "%A", "%B", "%C"];
      const swaps = computeSwaps(current, desired);

      expect(swaps.length).toBeLessThanOrEqual(3);
      expect(applySwaps(current, swaps)).toEqual(desired);
    });
  });

  describe("edge cases", () => {
    test("empty arrays return empty swaps", () => {
      const swaps = computeSwaps([], []);
      expect(swaps).toEqual([]);
    });

    test("single element returns empty swaps", () => {
      const swaps = computeSwaps(["%0"], ["%0"]);
      expect(swaps).toEqual([]);
    });

    test("realistic pane IDs with different numbers", () => {
      const current = ["%5", "%12", "%3"];
      const desired = ["%3", "%5", "%12"];
      const swaps = computeSwaps(current, desired);

      expect(swaps.length).toBeLessThanOrEqual(2);
      expect(applySwaps(current, swaps)).toEqual(desired);
    });
  });

  describe("swap count guarantees", () => {
    test("never more than N-1 swaps for N elements", () => {
      // Test multiple random-ish orderings
      const testCases: [string[], string[]][] = [
        [
          ["%0", "%1"],
          ["%1", "%0"],
        ],
        [
          ["%0", "%1", "%2"],
          ["%2", "%1", "%0"],
        ],
        [
          ["%0", "%1", "%2"],
          ["%1", "%2", "%0"],
        ],
        [
          ["%0", "%1", "%2", "%3"],
          ["%3", "%2", "%1", "%0"],
        ],
        [
          ["%0", "%1", "%2", "%3"],
          ["%1", "%0", "%3", "%2"],
        ],
        [
          ["%0", "%1", "%2", "%3", "%4"],
          ["%4", "%3", "%2", "%1", "%0"],
        ],
      ];

      for (const [current, desired] of testCases) {
        const swaps = computeSwaps(current, desired);
        const n = current.length;

        expect(swaps.length).toBeLessThanOrEqual(n - 1);
        expect(applySwaps(current, swaps)).toEqual(desired);
      }
    });

    test("optimal case: no swaps when already ordered", () => {
      const sizes = [1, 2, 3, 4, 5, 10];

      for (const size of sizes) {
        const order = Array.from({ length: size }, (_, i) => `%${i}`);
        const swaps = computeSwaps(order, order);
        expect(swaps.length).toBe(0);
      }
    });
  });

  describe("error handling", () => {
    test("throws when arrays have different lengths", () => {
      expect(() => computeSwaps(["%0", "%1"], ["%0"])).toThrow(
        "Order arrays must have same length"
      );
    });

    test("throws when desired order has unknown pane ID", () => {
      expect(() => computeSwaps(["%0", "%1"], ["%0", "%2"])).toThrow(
        'Pane ID "%2" from desired order not found in current order'
      );
    });

    test("throws when desired order has duplicate pane IDs", () => {
      expect(() => computeSwaps(["%0", "%1"], ["%0", "%0"])).toThrow(
        "Desired order contains duplicate pane IDs"
      );
    });

    test("throws when current order has duplicate pane IDs", () => {
      expect(() => computeSwaps(["%0", "%0"], ["%0", "%1"])).toThrow(
        "Current order contains duplicate pane IDs"
      );
    });
  });

  describe("swap sequence correctness", () => {
    test("swaps are executable in order", () => {
      // Each swap in the sequence should reference valid indices at that point
      const current = ["%A", "%B", "%C", "%D"];
      const desired = ["%D", "%C", "%B", "%A"];
      const swaps = computeSwaps(current, desired);

      // All indices should be within bounds
      for (const swap of swaps) {
        expect(swap.fromIndex).toBeGreaterThanOrEqual(0);
        expect(swap.fromIndex).toBeLessThan(current.length);
        expect(swap.toIndex).toBeGreaterThanOrEqual(0);
        expect(swap.toIndex).toBeLessThan(current.length);
      }
    });

    test("deterministic: same input always produces same swaps", () => {
      const current = ["%0", "%1", "%2", "%3"];
      const desired = ["%3", "%1", "%0", "%2"];

      const swaps1 = computeSwaps(current, desired);
      const swaps2 = computeSwaps(current, desired);

      expect(swaps1).toEqual(swaps2);
    });
  });
});

// Note: executeSwaps is not tested here as it requires a real tmux session.
// Integration tests should be added separately to verify tmux interaction.
