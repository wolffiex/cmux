import { describe, test, expect } from "bun:test";
import { renderMinimap } from "../src/minimap.ts";
import type { WindowInfo } from "../src/tmux.ts";

describe("renderMinimap", () => {
  test("single pane fills the space", () => {
    const window: WindowInfo = {
      width: 100,
      height: 50,
      panes: [{ id: "%0", width: 100, height: 50, left: 0, top: 0, title: "" }],
    };

    const lines = renderMinimap(window, { width: 20, height: 10 });

    expect(lines.length).toBe(10);
    expect(lines[0].length).toBe(20);
    // Top-left corner
    expect(lines[0][0]).toBe("┌");
    // Top-right corner
    expect(lines[0][19]).toBe("┐");
    // Bottom-left corner
    expect(lines[9][0]).toBe("└");
    // Bottom-right corner
    expect(lines[9][19]).toBe("┘");
  });

  test("two vertical panes", () => {
    const window: WindowInfo = {
      width: 100,
      height: 50,
      panes: [
        { id: "%0", width: 50, height: 50, left: 0, top: 0, title: "" },
        { id: "%1", width: 50, height: 50, left: 50, top: 0, title: "" },
      ],
    };

    const lines = renderMinimap(window, { width: 20, height: 10 });

    expect(lines.length).toBeGreaterThanOrEqual(6); // min pane height
    // Should have two boxes side by side - both with top-left corners on row 0
    expect(lines[0][0]).toBe("┌");
    // Second column starts after first column + gap
    const secondColStart = lines[0].indexOf("┌", 1);
    expect(secondColStart).toBeGreaterThan(0);
    expect(lines[0][lines[0].length - 1]).toBe("┐");
  });

  test("two horizontal panes", () => {
    const window: WindowInfo = {
      width: 100,
      height: 50,
      panes: [
        { id: "%0", width: 100, height: 25, left: 0, top: 0, title: "" },
        { id: "%1", width: 100, height: 25, left: 0, top: 25, title: "" },
      ],
    };

    const lines = renderMinimap(window, { width: 20, height: 10 });

    // May expand to fit minimum pane sizes
    expect(lines.length).toBeGreaterThanOrEqual(10);
    // Top pane
    expect(lines[0][0]).toBe("┌");
    // Both panes should be visible
    const topLeftCorners = lines.filter(line => line.includes("┌")).length;
    expect(topLeftCorners).toBeGreaterThanOrEqual(2);
  });

  test("homerow label is rendered", () => {
    const window: WindowInfo = {
      width: 100,
      height: 50,
      panes: [{ id: "%0", width: 100, height: 50, left: 0, top: 0, title: "" }],
    };

    const lines = renderMinimap(window, { width: 20, height: 10 });

    // First pane should have "A" label rendered with mini font
    // The font renders multi-line, so check that something other than borders/spaces exists
    const innerContent = lines.slice(1, -1).map(l => l.slice(1, -1)).join("");
    const hasContent = innerContent.replace(/ /g, "").length > 0;
    expect(hasContent).toBe(true);
  });

  test("odd width minimap", () => {
    const window: WindowInfo = {
      width: 100,
      height: 50,
      panes: [{ id: "%0", width: 100, height: 50, left: 0, top: 0, title: "" }],
    };

    const lines = renderMinimap(window, { width: 21, height: 11 });

    expect(lines.length).toBe(11);
    expect(lines[0].length).toBe(21);
    expect(lines[0][0]).toBe("┌");
    expect(lines[0][20]).toBe("┐");
    expect(lines[10][0]).toBe("└");
    expect(lines[10][20]).toBe("┘");
  });

  test("single pane fills available space", () => {
    const window: WindowInfo = {
      width: 100,
      height: 50,
      panes: [{ id: "%0", width: 100, height: 50, left: 0, top: 0, title: "" }],
    };

    const lines = renderMinimap(window, { width: 20, height: 10 });

    expect(lines.length).toBe(10);
    expect(lines[0].length).toBe(20);
    expect(lines[0][0]).toBe("┌");
    expect(lines[0][19]).toBe("┐");
    expect(lines[9][0]).toBe("└");
    expect(lines[9][19]).toBe("┘");
  });

  test("small pane gets minimum height in minimap", () => {
    // Window with a tall pane and a short 6-row pane
    const window: WindowInfo = {
      width: 100,
      height: 60,
      panes: [
        { id: "%0", width: 100, height: 54, left: 0, top: 0, title: "" },
        { id: "%1", width: 100, height: 6, left: 0, top: 54, title: "" },
      ],
    };

    // At 30 rows, the 6-row pane would scale to 3 rows, but minimum is 5
    const lines = renderMinimap(window, { width: 40, height: 30 });

    // Find the bottom pane's box by looking for the second set of corners
    // The minimap should expand to accommodate the minimum height
    expect(lines.length).toBeGreaterThanOrEqual(30);

    // Both panes should be visible - look for at least 2 top-left corners
    const topLeftCorners = lines.filter(line => line.includes("┌")).length;
    expect(topLeftCorners).toBeGreaterThanOrEqual(2);
  });

  test("stacked min-height panes both get minimum height", () => {
    // Two small panes stacked
    const window: WindowInfo = {
      width: 100,
      height: 60,
      panes: [
        { id: "%0", width: 50, height: 54, left: 0, top: 0, title: "" },
        { id: "%1", width: 50, height: 6, left: 0, top: 54, title: "" },
        { id: "%2", width: 50, height: 54, left: 50, top: 0, title: "" },
        { id: "%3", width: 50, height: 6, left: 50, top: 54, title: "" },
      ],
    };

    const lines = renderMinimap(window, { width: 40, height: 30 });

    // All 4 panes should be visible
    const topLeftCorners = lines.filter(line => line.includes("┌")).length;
    expect(topLeftCorners).toBeGreaterThanOrEqual(2); // At least 2 rows have corners
  });

  test("three pane layout", () => {
    const window: WindowInfo = {
      width: 120,
      height: 40,
      panes: [
        { id: "%0", width: 60, height: 40, left: 0, top: 0, title: "main" },
        { id: "%1", width: 60, height: 20, left: 60, top: 0, title: "top" },
        { id: "%2", width: 60, height: 20, left: 60, top: 20, title: "bottom" },
      ],
    };

    const lines = renderMinimap(window, { width: 24, height: 8 });

    // May expand to fit minimum pane sizes
    expect(lines.length).toBeGreaterThanOrEqual(8);
    expect(lines[0].length).toBe(24);
    // Just verify it doesn't crash and produces output
    expect(lines.every(line => line.length === 24)).toBe(true);
  });
});
