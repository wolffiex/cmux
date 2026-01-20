import { describe, expect, test } from "bun:test";
import {
  initTypeahead,
  filterItems,
  handleTypeaheadKey,
  renderTypeaheadLines,
  type TypeaheadItem,
} from "./typeahead";
import {
  Keys,
  type,
  simulate,
  selected,
  filteredLabels,
  renderedItems,
  assertSelect,
  assertCreate,
  assertContinue,
} from "./typeahead-test-utils";

// ── Test Fixtures ───────────────────────────────────────────────────────────

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

// ── Integration Tests Using Helpers ─────────────────────────────────────────

describe("typeahead scenarios", () => {
  test("type and select", () => {
    const state = initTypeahead(testItems);
    const afterTyping = type(state, "cl");

    expect(afterTyping.input).toBe("cl");
    expect(filteredLabels(afterTyping)).toEqual(["clardio"]);
    expect(selected(afterTyping)?.id).toBe("clardio");

    const result = handleTypeaheadKey(afterTyping, Keys.ENTER);
    assertSelect(result, "clardio");
  });

  test("navigate then select", () => {
    const state = initTypeahead(testItems);
    const result = simulate(state, Keys.DOWN, Keys.DOWN, Keys.ENTER);
    assertSelect(result, "shellbot");
  });

  test("type non-matching creates new", () => {
    const state = initTypeahead(testItems);
    const afterTyping = type(state, "newrepo");

    expect(filteredLabels(afterTyping)).toEqual([]);

    const result = handleTypeaheadKey(afterTyping, Keys.ENTER);
    assertCreate(result, "newrepo");
  });

  test("backspace restores items", () => {
    const state = initTypeahead(testItems);
    const afterTyping = type(state, "xyz");
    expect(filteredLabels(afterTyping)).toEqual([]);

    // Backspace three times to clear
    const result = simulate(afterTyping, Keys.BACKSPACE, Keys.BACKSPACE, Keys.BACKSPACE);
    const afterBackspace = assertContinue(result);
    expect(filteredLabels(afterBackspace)).toEqual(["cmux", "clardio", "shellbot"]);
  });

  test("escape cancels at any point", () => {
    const state = initTypeahead(testItems);
    const afterTyping = type(state, "cm");
    const result = handleTypeaheadKey(afterTyping, Keys.ESCAPE);
    expect(result.action).toBe("cancel");
  });

  test("up arrow wraps from top to bottom", () => {
    const state = initTypeahead(testItems);
    const result = handleTypeaheadKey(state, Keys.UP);
    if (result.action === "continue") {
      expect(selected(result.state)?.id).toBe("shellbot");
    }
  });

  test("down arrow wraps from bottom to top", () => {
    const state = { ...initTypeahead(testItems), selectedIndex: 2 };
    const result = handleTypeaheadKey(state, Keys.DOWN);
    if (result.action === "continue") {
      expect(selected(result.state)?.id).toBe("cmux");
    }
  });

  test("ctrl+n and ctrl+p work like arrows", () => {
    const state = initTypeahead(testItems);

    const down = handleTypeaheadKey(state, Keys.CTRL_N);
    if (down.action === "continue") {
      expect(selected(down.state)?.id).toBe("clardio");
    }

    const up = handleTypeaheadKey(state, Keys.CTRL_P);
    if (up.action === "continue") {
      expect(selected(up.state)?.id).toBe("shellbot");
    }
  });
});

describe("rendered output", () => {
  test("shows all items initially", () => {
    const state = initTypeahead(testItems);
    const items = renderedItems(state);
    expect(items).toContain("→ cmux main");
    expect(items.some(i => i.includes("clardio"))).toBe(true);
    expect(items.some(i => i.includes("shellbot"))).toBe(true);
  });

  test("shows filtered items after typing", () => {
    const state = type(initTypeahead(testItems), "sh");
    const items = renderedItems(state);
    expect(items.length).toBe(1);
    expect(items[0]).toContain("shellbot");
  });

  test("shows hint only for selected item", () => {
    const state = initTypeahead(testItems);
    const items = renderedItems(state);
    // First item (selected) should show hint
    expect(items[0]).toContain("main");
    // Second item should not show its hint
    expect(items[1]).not.toContain("feature-x");
  });
});
