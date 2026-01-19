import { describe, expect, test } from "bun:test";
import { generateLayoutString, type LayoutPane } from "../src/tmux-layout";

describe("generateLayoutString", () => {
  test("generates valid checksum format", () => {
    const result = generateLayoutString(
      [{ id: "%0", x: 0, y: 0, width: 80, height: 24 }],
      80,
      24,
    );
    // Checksum is 4 hex chars followed by comma
    expect(result).toMatch(/^[0-9a-f]{4},/);
  });

  test("single pane fills entire window", () => {
    const result = generateLayoutString(
      [{ id: "%0", x: 0, y: 0, width: 80, height: 24 }],
      80,
      24,
    );
    // Format: checksum,WxH,x,y,pane_id
    expect(result).toContain("80x24,0,0,0");
  });

  test("includes pane ID without percent sign", () => {
    const result = generateLayoutString(
      [{ id: "%5", x: 0, y: 0, width: 80, height: 24 }],
      80,
      24,
    );
    // Pane ID is serialized without the % prefix
    expect(result).toContain(",5");
    expect(result).not.toContain("%");
  });

  test("horizontal split (side by side)", () => {
    const result = generateLayoutString(
      [
        { id: "%0", x: 0, y: 0, width: 40, height: 24 },
        { id: "%1", x: 40, y: 0, width: 40, height: 24 },
      ],
      80,
      24,
    );
    // Horizontal splits use { }
    expect(result).toContain("{");
    expect(result).toContain("}");
    // Both panes should be present
    expect(result).toContain(",0");
    expect(result).toContain(",1");
  });

  test("vertical split (stacked)", () => {
    const result = generateLayoutString(
      [
        { id: "%0", x: 0, y: 0, width: 80, height: 12 },
        { id: "%1", x: 0, y: 12, width: 80, height: 12 },
      ],
      80,
      24,
    );
    // Vertical splits use [ ]
    expect(result).toContain("[");
    expect(result).toContain("]");
    // Both panes should be present
    expect(result).toContain(",0");
    expect(result).toContain(",1");
  });

  test("complex 2x2 grid layout", () => {
    const result = generateLayoutString(
      [
        { id: "%0", x: 0, y: 0, width: 40, height: 12 },
        { id: "%1", x: 40, y: 0, width: 40, height: 12 },
        { id: "%2", x: 0, y: 12, width: 40, height: 12 },
        { id: "%3", x: 40, y: 12, width: 40, height: 12 },
      ],
      80,
      24,
    );
    // Should have valid checksum
    expect(result).toMatch(/^[0-9a-f]{4},/);
    // All panes should be present
    expect(result).toContain(",0");
    expect(result).toContain(",1");
    expect(result).toContain(",2");
    expect(result).toContain(",3");
    // Should have nested structure (both horizontal and vertical)
    expect(result).toMatch(/[[{]/);
  });

  test("main pane with sidebar layout", () => {
    // Large left pane (70%) with smaller right pane (30%)
    const result = generateLayoutString(
      [
        { id: "%0", x: 0, y: 0, width: 56, height: 24 },
        { id: "%1", x: 56, y: 0, width: 24, height: 24 },
      ],
      80,
      24,
    );
    // Horizontal split
    expect(result).toContain("{");
    expect(result).toContain("}");
    // Check dimensions are included
    expect(result).toContain("56x24");
    expect(result).toContain("24x24");
  });

  test("three pane horizontal layout", () => {
    const result = generateLayoutString(
      [
        { id: "%0", x: 0, y: 0, width: 27, height: 24 },
        { id: "%1", x: 27, y: 0, width: 26, height: 24 },
        { id: "%2", x: 53, y: 0, width: 27, height: 24 },
      ],
      80,
      24,
    );
    // All three panes in horizontal split
    expect(result).toContain("{");
    expect(result).toContain(",0");
    expect(result).toContain(",1");
    expect(result).toContain(",2");
  });

  test("three pane vertical layout", () => {
    const result = generateLayoutString(
      [
        { id: "%0", x: 0, y: 0, width: 80, height: 8 },
        { id: "%1", x: 0, y: 8, width: 80, height: 8 },
        { id: "%2", x: 0, y: 16, width: 80, height: 8 },
      ],
      80,
      24,
    );
    // All three panes in vertical split
    expect(result).toContain("[");
    expect(result).toContain(",0");
    expect(result).toContain(",1");
    expect(result).toContain(",2");
  });

  test("checksum changes with different layouts", () => {
    const horizontal = generateLayoutString(
      [
        { id: "%0", x: 0, y: 0, width: 40, height: 24 },
        { id: "%1", x: 40, y: 0, width: 40, height: 24 },
      ],
      80,
      24,
    );
    const vertical = generateLayoutString(
      [
        { id: "%0", x: 0, y: 0, width: 80, height: 12 },
        { id: "%1", x: 0, y: 12, width: 80, height: 12 },
      ],
      80,
      24,
    );
    // Different layouts should have different checksums
    const horizontalChecksum = horizontal.substring(0, 4);
    const verticalChecksum = vertical.substring(0, 4);
    expect(horizontalChecksum).not.toBe(verticalChecksum);
  });

  test("checksum is deterministic", () => {
    const panes: LayoutPane[] = [
      { id: "%0", x: 0, y: 0, width: 80, height: 24 },
    ];
    const result1 = generateLayoutString(panes, 80, 24);
    const result2 = generateLayoutString(panes, 80, 24);
    expect(result1).toBe(result2);
  });

  test("throws error for empty pane list", () => {
    expect(() => generateLayoutString([], 80, 24)).toThrow("No panes provided");
  });
});
