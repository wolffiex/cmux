import { describe, expect, test } from "bun:test";
import {
  ALL_LAYOUTS,
  type LayoutTemplate,
  resolveLayout,
} from "../src/layouts";

describe("resolveLayout", () => {
  test("single pane fills entire window", () => {
    const template: LayoutTemplate = {
      name: "full",
      panes: [{ x: 0, y: 0, width: 1, height: 1 }],
    };
    const result = resolveLayout(template, 80, 24);
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
    expect(result[0].width).toBe(80);
    expect(result[0].height).toBe(24);
  });

  test("horizontal 50/50 split accounts for separator", () => {
    const template: LayoutTemplate = {
      name: "hsplit",
      panes: [
        { x: 0, y: 0, width: 0.5, height: 1 },
        { x: 0.5, y: 0, width: 0.5, height: 1 },
      ],
    };
    const result = resolveLayout(template, 80, 24);
    expect(result).toHaveLength(2);

    // Left pane: starts at 0, width is 50% of usable (80-1=79)
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
    expect(result[0].width).toBe(39); // floor(0.5 * 79)
    expect(result[0].height).toBe(24);

    // Right pane: starts after left + separator
    expect(result[1].x).toBe(40); // floor(0.5 * 79) + 1 separator
    expect(result[1].y).toBe(0);
    expect(result[1].width).toBe(40); // takes remaining
    expect(result[1].height).toBe(24);
  });

  test("vertical 50/50 split accounts for separator", () => {
    const template: LayoutTemplate = {
      name: "vsplit",
      panes: [
        { x: 0, y: 0, width: 1, height: 0.5 },
        { x: 0, y: 0.5, width: 1, height: 0.5 },
      ],
    };
    const result = resolveLayout(template, 80, 24);
    expect(result).toHaveLength(2);

    // Top pane: starts at 0, height is 50% of usable (24-1=23)
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
    expect(result[0].width).toBe(80);
    expect(result[0].height).toBe(11); // floor(0.5 * 23)

    // Bottom pane: starts after top + separator
    expect(result[1].x).toBe(0);
    expect(result[1].y).toBe(12); // floor(0.5 * 23) + 1 separator
    expect(result[1].width).toBe(80);
    expect(result[1].height).toBe(12); // takes remaining
  });

  test("handles negative height (fill remaining after min rows)", () => {
    const template: LayoutTemplate = {
      name: "main-with-bottom",
      panes: [
        { x: 0, y: 0, width: 1, height: -6 }, // fill remaining after 6 rows
        { x: 0, y: -6, width: 1, height: 6 }, // 6 rows from bottom
      ],
    };
    const result = resolveLayout(template, 80, 24);
    expect(result).toHaveLength(2);

    // Main pane: fills remaining after reserving 6 rows + 1 separator
    // Note: y=1 due to separator offset calculation (sorted y positions are [-6, 0])
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(1);
    expect(result[0].height).toBe(17); // 24 - 6 - 1 separator

    // Bottom pane: 6 rows at bottom
    expect(result[1].x).toBe(0);
    expect(result[1].y).toBe(18); // 24 - 6
    expect(result[1].height).toBe(6);
  });

  test("handles different window sizes", () => {
    const template: LayoutTemplate = {
      name: "full",
      panes: [{ x: 0, y: 0, width: 1, height: 1 }],
    };

    const small = resolveLayout(template, 40, 12);
    expect(small[0].width).toBe(40);
    expect(small[0].height).toBe(12);

    const large = resolveLayout(template, 200, 50);
    expect(large[0].width).toBe(200);
    expect(large[0].height).toBe(50);
  });

  test("4-pane grid accounts for separators", () => {
    const template: LayoutTemplate = {
      name: "grid",
      panes: [
        { x: 0, y: 0, width: 0.5, height: 0.5 },
        { x: 0, y: 0.5, width: 0.5, height: 0.5 },
        { x: 0.5, y: 0, width: 0.5, height: 0.5 },
        { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
      ],
    };
    const result = resolveLayout(template, 80, 24);
    expect(result).toHaveLength(4);

    // usableWidth = 80 - 1 = 79 (1 vertical separator)
    // usableHeight per column = 24 - 1 = 23 (1 horizontal separator)

    // Top-left
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
    expect(result[0].width).toBe(39); // floor(0.5 * 79)
    expect(result[0].height).toBe(11); // floor(0.5 * 23)

    // Bottom-left
    expect(result[1].x).toBe(0);
    expect(result[1].y).toBe(12); // 11 + 1 separator

    // Top-right
    expect(result[2].x).toBe(40); // 39 + 1 separator
    expect(result[2].y).toBe(0);

    // Bottom-right
    expect(result[3].x).toBe(40);
    expect(result[3].y).toBe(12);
  });

  test("3-pane layout with min-height bottom", () => {
    // Matches layouts3[0]: "left + right with bottom"
    const template: LayoutTemplate = {
      name: "left + right with bottom",
      panes: [
        { x: 0, y: 0, width: 0.5, height: 1 },
        { x: 0.5, y: 0, width: 0.5, height: -6 },
        { x: 0.5, y: -6, width: 0.5, height: 6 },
      ],
    };
    const result = resolveLayout(template, 80, 24);
    expect(result).toHaveLength(3);

    // Left pane: full height
    expect(result[0].x).toBe(0);
    expect(result[0].height).toBe(24);

    // Right top: fills remaining after 6 rows + separator
    expect(result[1].x).toBe(40);
    expect(result[1].height).toBe(17); // 24 - 6 - 1

    // Right bottom: 6 rows
    expect(result[2].x).toBe(40);
    expect(result[2].y).toBe(18);
    expect(result[2].height).toBe(6);
  });

  test("ALL_LAYOUTS are all resolvable with positive dimensions", () => {
    for (const layout of ALL_LAYOUTS) {
      const result = resolveLayout(layout, 80, 24);
      expect(result).toHaveLength(layout.panes.length);
      // All panes should have positive dimensions
      for (const pane of result) {
        expect(pane.width).toBeGreaterThan(0);
        expect(pane.height).toBeGreaterThan(0);
        expect(pane.x).toBeGreaterThanOrEqual(0);
        expect(pane.y).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("ALL_LAYOUTS panes fit within window bounds", () => {
    const windowWidth = 80;
    const windowHeight = 24;
    for (const layout of ALL_LAYOUTS) {
      const result = resolveLayout(layout, windowWidth, windowHeight);
      for (const pane of result) {
        expect(pane.x + pane.width).toBeLessThanOrEqual(windowWidth);
        expect(pane.y + pane.height).toBeLessThanOrEqual(windowHeight);
      }
    }
  });

  test("ALL_LAYOUTS work with various window sizes", () => {
    const sizes = [
      { w: 40, h: 12 },
      { w: 120, h: 40 },
      { w: 200, h: 60 },
    ];
    for (const { w, h } of sizes) {
      for (const layout of ALL_LAYOUTS) {
        const result = resolveLayout(layout, w, h);
        expect(result).toHaveLength(layout.panes.length);
        for (const pane of result) {
          expect(pane.width).toBeGreaterThan(0);
          expect(pane.height).toBeGreaterThan(0);
          expect(pane.x + pane.width).toBeLessThanOrEqual(w);
          expect(pane.y + pane.height).toBeLessThanOrEqual(h);
        }
      }
    }
  });
});
