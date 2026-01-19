import { expect, test } from "bun:test";
import { renderLayoutPreview } from "../src/layout-preview";
import { ALL_LAYOUTS } from "../src/layouts";

test("renders 1-pane layout as full box", () => {
  const layout = ALL_LAYOUTS[0]; // full
  const lines = renderLayoutPreview(layout, 10, 5);

  expect(lines[0]).toStartWith("┌");
  expect(lines[0]).toEndWith("┐");
  expect(lines[4]).toStartWith("└");
  expect(lines[4]).toEndWith("┘");
  expect(lines[2]).toContain("1");
});

test("renders 2-pane layout with vertical split", () => {
  const layout = ALL_LAYOUTS[1]; // 50/50
  const lines = renderLayoutPreview(layout, 20, 6);

  // Top should have T-junction for vertical split
  expect(lines[0]).toContain("┬");

  // Should have both pane numbers
  const allText = lines.join("");
  expect(allText).toContain("1");
  expect(allText).toContain("2");
});

test("renders 3-pane layout with horizontal and vertical splits", () => {
  const layout = ALL_LAYOUTS[2]; // left + right with bottom
  const lines = renderLayoutPreview(layout, 20, 8);

  // Should have all 3 pane numbers
  const allText = lines.join("");
  expect(allText).toContain("1");
  expect(allText).toContain("2");
  expect(allText).toContain("3");

  // Should have T-junction (├ or ┤)
  expect(allText).toMatch(/[├┤]/);
});

test("renders 4-pane layout", () => {
  const layout = ALL_LAYOUTS.find((l) => l.panes.length === 4)!;
  const lines = renderLayoutPreview(layout, 20, 8);

  const allText = lines.join("");
  expect(allText).toContain("1");
  expect(allText).toContain("2");
  expect(allText).toContain("3");
  expect(allText).toContain("4");
});

test("output dimensions match input", () => {
  const layout = ALL_LAYOUTS[0];
  const lines = renderLayoutPreview(layout, 15, 7);

  expect(lines.length).toBe(7);
  expect(lines[0].length).toBe(15);
});

test("handles small dimensions", () => {
  const layout = ALL_LAYOUTS[1];
  const lines = renderLayoutPreview(layout, 6, 4);

  expect(lines.length).toBe(4);
  expect(lines[0].length).toBe(6);
});
