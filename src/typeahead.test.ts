import { describe, expect, test } from "bun:test";
import {
  initTypeahead,
  filterItems,
  handleTypeaheadKey,
  renderTypeaheadLines,
  type TypeaheadItem,
} from "./typeahead";

const testItems: TypeaheadItem[] = [
  { id: "cmux", label: "cmux", hint: "main" },
  { id: "clardio", label: "clardio", hint: "feature-x", marker: "·" },
  { id: "shellbot", label: "shellbot" },
];

describe("initTypeahead", () => {
  test("initializes with items", () => {
    const state = initTypeahead(testItems, "Choose repo");
    expect(state.input).toBe("");
    expect(state.items).toEqual(testItems);
    expect(state.filtered).toEqual(testItems);
    expect(state.selectedIndex).toBe(0);
    expect(state.title).toBe("Choose repo");
  });
});

describe("filterItems", () => {
  test("returns all items when input is empty", () => {
    expect(filterItems(testItems, "")).toEqual(testItems);
  });

  test("filters by substring match", () => {
    expect(filterItems(testItems, "cl")).toEqual([testItems[1]]);
  });

  test("is case insensitive", () => {
    expect(filterItems(testItems, "CL")).toEqual([testItems[1]]);
  });

  test("returns empty when no match", () => {
    expect(filterItems(testItems, "xyz")).toEqual([]);
  });
});

describe("handleTypeaheadKey", () => {
  test("escape cancels", () => {
    const state = initTypeahead(testItems);
    const result = handleTypeaheadKey(state, "\x1b");
    expect(result.action).toBe("cancel");
  });

  test("enter selects current item", () => {
    const state = initTypeahead(testItems);
    const result = handleTypeaheadKey(state, "\r");
    expect(result.action).toBe("select");
    if (result.action === "select") {
      expect(result.item.id).toBe("cmux");
    }
  });

  test("enter with no matches returns create action", () => {
    const state = { ...initTypeahead(testItems), input: "newrepo", filtered: [] };
    const result = handleTypeaheadKey(state, "\r");
    expect(result.action).toBe("create");
    if (result.action === "create") {
      expect(result.input).toBe("newrepo");
    }
  });

  test("down arrow moves selection", () => {
    const state = initTypeahead(testItems);
    const result = handleTypeaheadKey(state, "\x1b[B");
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.state.selectedIndex).toBe(1);
    }
  });

  test("up arrow wraps to bottom", () => {
    const state = initTypeahead(testItems);
    const result = handleTypeaheadKey(state, "\x1b[A");
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.state.selectedIndex).toBe(2);
    }
  });

  test("typing filters items", () => {
    const state = initTypeahead(testItems);
    const result = handleTypeaheadKey(state, "s");
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.state.input).toBe("s");
      expect(result.state.filtered.length).toBe(1);
      expect(result.state.filtered[0].id).toBe("shellbot");
    }
  });

  test("backspace removes character", () => {
    const state = { ...initTypeahead(testItems), input: "cm" };
    const result = handleTypeaheadKey(state, "\x7f");
    expect(result.action).toBe("continue");
    if (result.action === "continue") {
      expect(result.state.input).toBe("c");
    }
  });
});

describe("renderTypeaheadLines", () => {
  test("renders with title", () => {
    const state = initTypeahead(testItems, "Pick one");
    const lines = renderTypeaheadLines(state, 60, 20);
    expect(lines[0]).toContain("Pick one");
  });

  test("shows selected item with arrow", () => {
    const state = initTypeahead(testItems);
    const lines = renderTypeaheadLines(state, 60, 20);
    const selectedLine = lines.find((l) => l.includes("→"));
    expect(selectedLine).toContain("cmux");
  });

  test("shows marker for items that have one", () => {
    const state = { ...initTypeahead(testItems), selectedIndex: 1 };
    const lines = renderTypeaheadLines(state, 60, 20);
    const clardioLine = lines.find((l) => l.includes("clardio"));
    expect(clardioLine).toContain("·");
  });
});
