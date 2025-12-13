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

    expect(lines.length).toBe(10);
    // Should have two boxes side by side
    // Left pane corners
    expect(lines[0][0]).toBe("┌");
    expect(lines[0][9]).toBe("┐");
    // Right pane corners
    expect(lines[0][10]).toBe("┌");
    expect(lines[0][19]).toBe("┐");
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

    expect(lines.length).toBe(10);
    // Top pane
    expect(lines[0][0]).toBe("┌");
    expect(lines[4][0]).toBe("└");
    // Bottom pane
    expect(lines[5][0]).toBe("┌");
    expect(lines[9][0]).toBe("└");
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

  test("very small minimap", () => {
    const window: WindowInfo = {
      width: 100,
      height: 50,
      panes: [{ id: "%0", width: 100, height: 50, left: 0, top: 0, title: "" }],
    };

    const lines = renderMinimap(window, { width: 4, height: 3 });

    expect(lines.length).toBe(3);
    expect(lines[0].length).toBe(4);
    expect(lines[0]).toBe("┌──┐");
    expect(lines[1]).toBe("│  │");
    expect(lines[2]).toBe("└──┘");
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

    expect(lines.length).toBe(8);
    expect(lines[0].length).toBe(24);
    // Just verify it doesn't crash and produces output
    expect(lines.every(line => line.length === 24)).toBe(true);
  });
});
