import { describe, expect, test } from "bun:test";
import {
  calculateOverlap,
  centerDistance,
  matchPanesToSlots,
  type Pane,
  type Slot,
} from "../src/pane-matcher";

describe("calculateOverlap", () => {
  test("returns full area for identical pane and slot", () => {
    const pane: Pane = { id: "%0", x: 0, y: 0, width: 40, height: 24 };
    const slot: Slot = { x: 0, y: 0, width: 40, height: 24 };
    expect(calculateOverlap(pane, slot)).toBe(40 * 24);
  });

  test("returns partial overlap for overlapping rectangles", () => {
    const pane: Pane = { id: "%0", x: 0, y: 0, width: 40, height: 24 };
    const slot: Slot = { x: 20, y: 12, width: 40, height: 24 };
    // Overlap: x from 20 to 40 (20 units), y from 12 to 24 (12 units)
    expect(calculateOverlap(pane, slot)).toBe(20 * 12);
  });

  test("returns zero for non-overlapping rectangles", () => {
    const pane: Pane = { id: "%0", x: 0, y: 0, width: 40, height: 24 };
    const slot: Slot = { x: 50, y: 30, width: 40, height: 24 };
    expect(calculateOverlap(pane, slot)).toBe(0);
  });

  test("returns zero for adjacent rectangles (touching but not overlapping)", () => {
    const pane: Pane = { id: "%0", x: 0, y: 0, width: 40, height: 24 };
    const slot: Slot = { x: 40, y: 0, width: 40, height: 24 };
    expect(calculateOverlap(pane, slot)).toBe(0);
  });

  test("handles slot contained within pane", () => {
    const pane: Pane = { id: "%0", x: 0, y: 0, width: 80, height: 48 };
    const slot: Slot = { x: 10, y: 10, width: 20, height: 20 };
    expect(calculateOverlap(pane, slot)).toBe(20 * 20);
  });

  test("handles pane contained within slot", () => {
    const pane: Pane = { id: "%0", x: 10, y: 10, width: 20, height: 20 };
    const slot: Slot = { x: 0, y: 0, width: 80, height: 48 };
    expect(calculateOverlap(pane, slot)).toBe(20 * 20);
  });
});

describe("centerDistance", () => {
  test("returns zero for identical pane and slot", () => {
    const pane: Pane = { id: "%0", x: 0, y: 0, width: 40, height: 24 };
    const slot: Slot = { x: 0, y: 0, width: 40, height: 24 };
    expect(centerDistance(pane, slot)).toBe(0);
  });

  test("calculates horizontal distance correctly", () => {
    const pane: Pane = { id: "%0", x: 0, y: 0, width: 40, height: 24 };
    const slot: Slot = { x: 40, y: 0, width: 40, height: 24 };
    // Pane center: (20, 12), Slot center: (60, 12)
    // Distance: 40
    expect(centerDistance(pane, slot)).toBe(40);
  });

  test("calculates vertical distance correctly", () => {
    const pane: Pane = { id: "%0", x: 0, y: 0, width: 80, height: 12 };
    const slot: Slot = { x: 0, y: 12, width: 80, height: 12 };
    // Pane center: (40, 6), Slot center: (40, 18)
    // Distance: 12
    expect(centerDistance(pane, slot)).toBe(12);
  });

  test("calculates diagonal distance correctly", () => {
    const pane: Pane = { id: "%0", x: 0, y: 0, width: 40, height: 24 };
    const slot: Slot = { x: 40, y: 24, width: 40, height: 24 };
    // Pane center: (20, 12), Slot center: (60, 36)
    // Distance: sqrt(40^2 + 24^2) = sqrt(1600 + 576) = sqrt(2176)
    expect(centerDistance(pane, slot)).toBeCloseTo(Math.sqrt(2176), 5);
  });
});

describe("matchPanesToSlots", () => {
  describe("basic matching", () => {
    test("matches 2 panes to 2 slots with clear overlap", () => {
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 40, height: 24 },
        { id: "%1", x: 40, y: 0, width: 40, height: 24 },
      ];
      const slots: Slot[] = [
        { x: 0, y: 0, width: 40, height: 24 },
        { x: 40, y: 0, width: 40, height: 24 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(2);
      expect(result.unmatchedSlots).toHaveLength(0);
      expect(result.unmatchedPanes).toHaveLength(0);

      // Check that panes matched to correct slots
      const slot0Match = result.matches.find((m) => m.slotIndex === 0);
      const slot1Match = result.matches.find((m) => m.slotIndex === 1);
      expect(slot0Match?.paneId).toBe("%0");
      expect(slot1Match?.paneId).toBe("%1");
    });

    test("matches panes to similar but not identical slots", () => {
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 38, height: 24 },
        { id: "%1", x: 39, y: 0, width: 41, height: 24 },
      ];
      const slots: Slot[] = [
        { x: 0, y: 0, width: 40, height: 24 },
        { x: 40, y: 0, width: 40, height: 24 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(2);
      const slot0Match = result.matches.find((m) => m.slotIndex === 0);
      const slot1Match = result.matches.find((m) => m.slotIndex === 1);
      expect(slot0Match?.paneId).toBe("%0");
      expect(slot1Match?.paneId).toBe("%1");
    });
  });

  describe("no overlap fallback (centroid distance)", () => {
    test("matches horizontal layout to vertical layout", () => {
      // Horizontal split: left and right panes
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 40, height: 24 },
        { id: "%1", x: 40, y: 0, width: 40, height: 24 },
      ];
      // Vertical split: top and bottom slots
      const slots: Slot[] = [
        { x: 0, y: 0, width: 80, height: 12 },
        { x: 0, y: 12, width: 80, height: 12 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(2);
      expect(result.unmatchedSlots).toHaveLength(0);
      expect(result.unmatchedPanes).toHaveLength(0);

      // Left pane center is at (20, 12), closer to top slot center (40, 6)
      // Right pane center is at (60, 12), also closer to top slot center
      // But the algorithm should still produce valid matches
    });

    test("matches vertical layout to horizontal layout", () => {
      // Vertical split: top and bottom panes
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 80, height: 12 },
        { id: "%1", x: 0, y: 12, width: 80, height: 12 },
      ];
      // Horizontal split: left and right slots
      const slots: Slot[] = [
        { x: 0, y: 0, width: 40, height: 24 },
        { x: 40, y: 0, width: 40, height: 24 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(2);
      expect(result.unmatchedSlots).toHaveLength(0);
      expect(result.unmatchedPanes).toHaveLength(0);
    });
  });

  describe("adding panes", () => {
    test("2 panes, 3 slots -> 2 matches + 1 unmatchedSlot", () => {
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 40, height: 24 },
        { id: "%1", x: 40, y: 0, width: 40, height: 24 },
      ];
      const slots: Slot[] = [
        { x: 0, y: 0, width: 27, height: 24 },
        { x: 27, y: 0, width: 26, height: 24 },
        { x: 53, y: 0, width: 27, height: 24 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(2);
      expect(result.unmatchedSlots).toHaveLength(1);
      expect(result.unmatchedPanes).toHaveLength(0);
    });

    test("1 pane, 4 slots -> 1 match + 3 unmatchedSlots", () => {
      const panes: Pane[] = [{ id: "%0", x: 0, y: 0, width: 80, height: 24 }];
      const slots: Slot[] = [
        { x: 0, y: 0, width: 40, height: 12 },
        { x: 40, y: 0, width: 40, height: 12 },
        { x: 0, y: 12, width: 40, height: 12 },
        { x: 40, y: 12, width: 40, height: 12 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(1);
      expect(result.unmatchedSlots).toHaveLength(3);
      expect(result.unmatchedPanes).toHaveLength(0);
    });
  });

  describe("removing panes", () => {
    test("3 panes, 2 slots -> 2 matches + 1 unmatchedPane", () => {
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 27, height: 24 },
        { id: "%1", x: 27, y: 0, width: 26, height: 24 },
        { id: "%2", x: 53, y: 0, width: 27, height: 24 },
      ];
      const slots: Slot[] = [
        { x: 0, y: 0, width: 40, height: 24 },
        { x: 40, y: 0, width: 40, height: 24 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(2);
      expect(result.unmatchedSlots).toHaveLength(0);
      expect(result.unmatchedPanes).toHaveLength(1);
    });

    test("4 panes, 1 slot -> 1 match + 3 unmatchedPanes", () => {
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 40, height: 12 },
        { id: "%1", x: 40, y: 0, width: 40, height: 12 },
        { id: "%2", x: 0, y: 12, width: 40, height: 12 },
        { id: "%3", x: 40, y: 12, width: 40, height: 12 },
      ];
      const slots: Slot[] = [{ x: 0, y: 0, width: 80, height: 24 }];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(1);
      expect(result.unmatchedSlots).toHaveLength(0);
      expect(result.unmatchedPanes).toHaveLength(3);
    });
  });

  describe("same count, optimal positions", () => {
    test("panes already in optimal positions", () => {
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 40, height: 24 },
        { id: "%1", x: 40, y: 0, width: 40, height: 24 },
      ];
      const slots: Slot[] = [
        { x: 0, y: 0, width: 40, height: 24 },
        { x: 40, y: 0, width: 40, height: 24 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(2);
      // Scores should be maximum (full overlap)
      const match0 = result.matches.find((m) => m.paneId === "%0");
      const match1 = result.matches.find((m) => m.paneId === "%1");
      expect(match0?.score).toBe(40 * 24);
      expect(match1?.score).toBe(40 * 24);
    });

    test("3x3 grid stays matched correctly", () => {
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 27, height: 12 },
        { id: "%1", x: 27, y: 0, width: 26, height: 12 },
        { id: "%2", x: 53, y: 0, width: 27, height: 12 },
        { id: "%3", x: 0, y: 12, width: 27, height: 12 },
        { id: "%4", x: 27, y: 12, width: 26, height: 12 },
        { id: "%5", x: 53, y: 12, width: 27, height: 12 },
      ];
      const slots: Slot[] = [
        { x: 0, y: 0, width: 27, height: 12 },
        { x: 27, y: 0, width: 26, height: 12 },
        { x: 53, y: 0, width: 27, height: 12 },
        { x: 0, y: 12, width: 27, height: 12 },
        { x: 27, y: 12, width: 26, height: 12 },
        { x: 53, y: 12, width: 27, height: 12 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(6);
      expect(result.unmatchedSlots).toHaveLength(0);
      expect(result.unmatchedPanes).toHaveLength(0);

      // Each pane should match to its corresponding slot
      for (let i = 0; i < 6; i++) {
        const match = result.matches.find((m) => m.paneId === `%${i}`);
        expect(match?.slotIndex).toBe(i);
      }
    });
  });

  describe("edge cases", () => {
    test("empty panes array", () => {
      const panes: Pane[] = [];
      const slots: Slot[] = [{ x: 0, y: 0, width: 80, height: 24 }];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(0);
      expect(result.unmatchedSlots).toEqual([0]);
      expect(result.unmatchedPanes).toHaveLength(0);
    });

    test("empty slots array", () => {
      const panes: Pane[] = [{ id: "%0", x: 0, y: 0, width: 80, height: 24 }];
      const slots: Slot[] = [];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(0);
      expect(result.unmatchedSlots).toHaveLength(0);
      expect(result.unmatchedPanes).toEqual(["%0"]);
    });

    test("both arrays empty", () => {
      const result = matchPanesToSlots([], []);

      expect(result.matches).toHaveLength(0);
      expect(result.unmatchedSlots).toHaveLength(0);
      expect(result.unmatchedPanes).toHaveLength(0);
    });

    test("single pane, single slot", () => {
      const panes: Pane[] = [{ id: "%0", x: 0, y: 0, width: 80, height: 24 }];
      const slots: Slot[] = [{ x: 0, y: 0, width: 80, height: 24 }];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].paneId).toBe("%0");
      expect(result.matches[0].slotIndex).toBe(0);
      expect(result.unmatchedSlots).toHaveLength(0);
      expect(result.unmatchedPanes).toHaveLength(0);
    });

    test("single pane with no overlap to any slot", () => {
      const panes: Pane[] = [
        { id: "%0", x: 100, y: 100, width: 40, height: 24 },
      ];
      const slots: Slot[] = [{ x: 0, y: 0, width: 40, height: 24 }];

      const result = matchPanesToSlots(panes, slots);

      // Should still match based on distance
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].paneId).toBe("%0");
      expect(result.matches[0].slotIndex).toBe(0);
      expect(result.matches[0].score).toBeLessThan(0); // Negative score from distance
    });
  });

  describe("tiebreaking", () => {
    test("equal overlap scores - picks one consistently", () => {
      // Two panes with equal overlap to both slots
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 80, height: 12 },
        { id: "%1", x: 0, y: 12, width: 80, height: 12 },
      ];
      // Two slots that both have 50% overlap with both panes
      const slots: Slot[] = [
        { x: 0, y: 6, width: 80, height: 12 },
        { x: 0, y: 6, width: 80, height: 12 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(2);
      expect(result.unmatchedSlots).toHaveLength(0);
      expect(result.unmatchedPanes).toHaveLength(0);

      // Both panes should be matched (to different slots)
      const matchedPaneIds = result.matches.map((m) => m.paneId).sort();
      expect(matchedPaneIds).toEqual(["%0", "%1"]);
    });

    test("deterministic results for same input", () => {
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 40, height: 24 },
        { id: "%1", x: 40, y: 0, width: 40, height: 24 },
      ];
      const slots: Slot[] = [
        { x: 0, y: 0, width: 40, height: 24 },
        { x: 40, y: 0, width: 40, height: 24 },
      ];

      const result1 = matchPanesToSlots(panes, slots);
      const result2 = matchPanesToSlots(panes, slots);

      expect(result1).toEqual(result2);
    });
  });

  describe("realistic layout transitions", () => {
    test("50/50 horizontal to 70/30 horizontal", () => {
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 40, height: 24 },
        { id: "%1", x: 40, y: 0, width: 40, height: 24 },
      ];
      const slots: Slot[] = [
        { x: 0, y: 0, width: 56, height: 24 },
        { x: 56, y: 0, width: 24, height: 24 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(2);
      // Left pane should match left slot (more overlap)
      const leftSlotMatch = result.matches.find((m) => m.slotIndex === 0);
      expect(leftSlotMatch?.paneId).toBe("%0");
    });

    test("2 panes to 3 panes (adding bottom-right)", () => {
      // Start: left pane + right pane
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 40, height: 24 },
        { id: "%1", x: 40, y: 0, width: 40, height: 24 },
      ];
      // Target: left pane + right-top + right-bottom
      const slots: Slot[] = [
        { x: 0, y: 0, width: 40, height: 24 },
        { x: 40, y: 0, width: 40, height: 12 },
        { x: 40, y: 12, width: 40, height: 12 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(2);
      expect(result.unmatchedSlots).toHaveLength(1);
      expect(result.unmatchedPanes).toHaveLength(0);

      // Left pane should match left slot
      const leftMatch = result.matches.find((m) => m.slotIndex === 0);
      expect(leftMatch?.paneId).toBe("%0");

      // Right pane should match TOP-RIGHT slot (index 1), not bottom
      // This ensures new panes appear at the bottom, preserving existing content at top
      const rightMatch = result.matches.find((m) => m.paneId === "%1");
      expect(rightMatch?.slotIndex).toBe(1); // top-right slot

      // Bottom-right slot (index 2) should be unmatched - new pane goes there
      expect(result.unmatchedSlots).toContain(2);
    });

    test("2 panes to 3 panes (adding bottom-left)", () => {
      // Start: left pane + right pane
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 40, height: 24 },
        { id: "%1", x: 40, y: 0, width: 40, height: 24 },
      ];
      // Target: left-top + left-bottom + right pane
      const slots: Slot[] = [
        { x: 0, y: 0, width: 40, height: 12 },
        { x: 0, y: 12, width: 40, height: 12 },
        { x: 40, y: 0, width: 40, height: 24 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(2);
      expect(result.unmatchedSlots).toHaveLength(1);
      expect(result.unmatchedPanes).toHaveLength(0);

      // Left pane should match TOP-LEFT slot (index 0), not bottom
      const leftMatch = result.matches.find((m) => m.paneId === "%0");
      expect(leftMatch?.slotIndex).toBe(0); // top-left slot

      // Right pane should match right slot
      const rightMatch = result.matches.find((m) => m.paneId === "%1");
      expect(rightMatch?.slotIndex).toBe(2);

      // Bottom-left slot (index 1) should be unmatched - new pane goes there
      expect(result.unmatchedSlots).toContain(1);
    });

    test("3 panes to 2 panes (removing bottom-right)", () => {
      // Start: left pane + right-top + right-bottom
      const panes: Pane[] = [
        { id: "%0", x: 0, y: 0, width: 40, height: 24 },
        { id: "%1", x: 40, y: 0, width: 40, height: 12 },
        { id: "%2", x: 40, y: 12, width: 40, height: 12 },
      ];
      // Target: left pane + right pane
      const slots: Slot[] = [
        { x: 0, y: 0, width: 40, height: 24 },
        { x: 40, y: 0, width: 40, height: 24 },
      ];

      const result = matchPanesToSlots(panes, slots);

      expect(result.matches).toHaveLength(2);
      expect(result.unmatchedSlots).toHaveLength(0);
      expect(result.unmatchedPanes).toHaveLength(1);

      // Left pane should match left slot
      const leftMatch = result.matches.find((m) => m.slotIndex === 0);
      expect(leftMatch?.paneId).toBe("%0");
    });
  });
});
