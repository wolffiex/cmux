import { test, expect, describe } from "bun:test"
import {
  DirPickerState,
  handleDirPickerKey,
  renderDirPickerLines,
  filterCousins,
  initDirPickerState,
} from "../src/dir-picker"

describe("filterCousins", () => {
  test("returns all cousins when input is empty", () => {
    const cousins = ["apple", "banana", "cherry"]
    expect(filterCousins(cousins, "")).toEqual(cousins)
  })

  test("filters by prefix case-insensitively", () => {
    const cousins = ["apple", "Apricot", "banana"]
    expect(filterCousins(cousins, "a")).toEqual(["apple", "Apricot"])
    expect(filterCousins(cousins, "A")).toEqual(["apple", "Apricot"])
  })

  test("returns empty array when no matches", () => {
    const cousins = ["apple", "banana"]
    expect(filterCousins(cousins, "z")).toEqual([])
  })
})

describe("handleDirPickerKey", () => {
  function makeState(overrides: Partial<DirPickerState> = {}): DirPickerState {
    return {
      input: "",
      cousins: ["apple", "banana", "apricot"],
      filtered: ["apple", "banana", "apricot"],
      selectedIndex: 0,
      parentPath: "/home/user",
      currentPath: "/home/user/current",
      ...overrides,
    }
  }

  test("typing a character filters the list", () => {
    const state = makeState()
    const result = handleDirPickerKey(state, "a")

    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.input).toBe("a")
      expect(result.state.filtered).toEqual(["apple", "apricot"])
      expect(result.state.selectedIndex).toBe(0)
    }
  })

  test("typing multiple characters narrows the filter", () => {
    let state = makeState()

    let result = handleDirPickerKey(state, "a")
    expect(result.action).toBe("continue")
    if (result.action === "continue") state = result.state

    result = handleDirPickerKey(state, "p")
    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.input).toBe("ap")
      expect(result.state.filtered).toEqual(["apple", "apricot"])
      state = result.state
    }

    result = handleDirPickerKey(state, "r")
    expect(result.action).toBe("continue")
    if (result.action === "continue") state = result.state

    result = handleDirPickerKey(state, "i")
    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.input).toBe("apri")
      expect(result.state.filtered).toEqual(["apricot"])
    }
  })

  test("backspace removes last character and updates filter", () => {
    const state = makeState({ input: "ap", filtered: ["apple", "apricot"] })
    const result = handleDirPickerKey(state, "\x7f")

    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.input).toBe("a")
      expect(result.state.filtered).toEqual(["apple", "apricot"])
    }
  })

  test("backspace on empty input does nothing", () => {
    const state = makeState({ input: "" })
    const result = handleDirPickerKey(state, "\x7f")

    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.input).toBe("")
    }
  })

  test("Ctrl+N moves selection down", () => {
    const state = makeState({ selectedIndex: 0 })
    const result = handleDirPickerKey(state, "\x0e")

    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.selectedIndex).toBe(1)
    }
  })

  test("Ctrl+P moves selection up", () => {
    const state = makeState({ selectedIndex: 1 })
    const result = handleDirPickerKey(state, "\x10")

    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.selectedIndex).toBe(0)
    }
  })

  test("Ctrl+N wraps around at bottom", () => {
    const state = makeState({ selectedIndex: 2 })
    const result = handleDirPickerKey(state, "\x0e")

    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.selectedIndex).toBe(0)
    }
  })

  test("Ctrl+P wraps around at top", () => {
    const state = makeState({ selectedIndex: 0 })
    const result = handleDirPickerKey(state, "\x10")

    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.selectedIndex).toBe(2)
    }
  })

  test("Down arrow moves selection down", () => {
    const state = makeState({ selectedIndex: 0 })
    const result = handleDirPickerKey(state, "\x1b[B")

    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.selectedIndex).toBe(1)
    }
  })

  test("Up arrow moves selection up", () => {
    const state = makeState({ selectedIndex: 1 })
    const result = handleDirPickerKey(state, "\x1b[A")

    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.selectedIndex).toBe(0)
    }
  })

  test("j is typed as literal character", () => {
    const state = makeState()
    const result = handleDirPickerKey(state, "j")

    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.input).toBe("j")
    }
  })

  test("k is typed as literal character", () => {
    const state = makeState()
    const result = handleDirPickerKey(state, "k")

    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      expect(result.state.input).toBe("k")
    }
  })

  test("Escape cancels", () => {
    const state = makeState()
    const result = handleDirPickerKey(state, "\x1b")

    expect(result.action).toBe("cancel")
  })

  test("Enter selects highlighted item", () => {
    const state = makeState({ selectedIndex: 1 })
    const result = handleDirPickerKey(state, "\r")

    expect(result.action).toBe("select")
    if (result.action === "select") {
      expect(result.path).toBe("/home/user/banana")
    }
  })

  test("Enter with no matches uses input as relative path", () => {
    const state = makeState({ input: "new-dir", filtered: [] })
    const result = handleDirPickerKey(state, "\r")

    expect(result.action).toBe("select")
    if (result.action === "select") {
      expect(result.path).toBe("/home/user/current/new-dir")
    }
  })

  test("Enter with empty input and no filtered items cancels", () => {
    const state = makeState({ input: "", filtered: [] })
    const result = handleDirPickerKey(state, "\r")

    expect(result.action).toBe("cancel")
  })
})

describe("renderDirPickerLines", () => {
  function makeState(overrides: Partial<DirPickerState> = {}): DirPickerState {
    return {
      input: "",
      cousins: ["apple", "banana", "cherry"],
      filtered: ["apple", "banana", "cherry"],
      selectedIndex: 0,
      parentPath: "/home/user",
      currentPath: "/home/user/current",
      ...overrides,
    }
  }

  test("renders input with cursor", () => {
    const state = makeState({ input: "app" })
    const lines = renderDirPickerLines(state, 50, 20)

    const inputLine = lines.find(l => l.includes("> "))
    expect(inputLine).toContain("> app█")
  })

  test("renders filtered items", () => {
    const state = makeState()
    const lines = renderDirPickerLines(state, 50, 20)

    const content = lines.join("\n")
    expect(content).toContain("apple")
    expect(content).toContain("banana")
    expect(content).toContain("cherry")
  })

  test("highlights selected item with arrow", () => {
    const state = makeState({ selectedIndex: 1 })
    const lines = renderDirPickerLines(state, 50, 20)

    const content = lines.join("\n")
    expect(content).toContain("→ banana")
    expect(content).not.toContain("→ apple")
  })

  test("filters displayed items", () => {
    const state = makeState({ input: "a", filtered: ["apple"] })
    const lines = renderDirPickerLines(state, 50, 20)

    const content = lines.join("\n")
    expect(content).toContain("apple")
    expect(content).not.toContain("banana")
    expect(content).not.toContain("cherry")
  })

  test("draws box borders", () => {
    const state = makeState()
    const lines = renderDirPickerLines(state, 50, 20)

    // Top border
    expect(lines[0]).toStartWith("┌")
    expect(lines[0]).toEndWith("┐")

    // Bottom border
    expect(lines[lines.length - 1]).toStartWith("└")
    expect(lines[lines.length - 1]).toEndWith("┘")

    // Side borders
    expect(lines[1]).toStartWith("│")
    expect(lines[1]).toEndWith("│")
  })
})

describe("end-to-end typeahead flow", () => {
  test("full interaction: type, navigate, select", () => {
    // Start with initial state
    let state: DirPickerState = {
      input: "",
      cousins: ["frontend", "backend", "docs", "scripts"],
      filtered: ["frontend", "backend", "docs", "scripts"],
      selectedIndex: 0,
      parentPath: "/projects",
      currentPath: "/projects/myapp",
    }

    // Type "f" to filter
    let result = handleDirPickerKey(state, "f")
    expect(result.action).toBe("continue")
    if (result.action === "continue") {
      state = result.state
      expect(state.filtered).toEqual(["frontend"])
    }

    // Verify render shows filtered result
    let lines = renderDirPickerLines(state, 50, 20)
    let content = lines.join("\n")
    expect(content).toContain("frontend")
    expect(content).not.toContain("backend")

    // Clear filter with backspace
    result = handleDirPickerKey(state, "\x7f")
    if (result.action === "continue") {
      state = result.state
      expect(state.filtered.length).toBe(4)
    }

    // Type "b" to filter to backend
    result = handleDirPickerKey(state, "b")
    if (result.action === "continue") {
      state = result.state
      expect(state.filtered).toEqual(["backend"])
    }

    // Press Enter to select
    result = handleDirPickerKey(state, "\r")
    expect(result.action).toBe("select")
    if (result.action === "select") {
      expect(result.path).toBe("/projects/backend")
    }
  })

  test("creating new directory via relative path", () => {
    let state: DirPickerState = {
      input: "",
      cousins: ["existing-project"],
      filtered: ["existing-project"],
      selectedIndex: 0,
      parentPath: "/home/user",
      currentPath: "/home/user/myapp",
    }

    // Type a name that doesn't match any cousin
    for (const char of "new-feature") {
      const result = handleDirPickerKey(state, char)
      if (result.action === "continue") state = result.state
    }

    expect(state.input).toBe("new-feature")
    expect(state.filtered).toEqual([])

    // Verify render shows the typed input
    const lines = renderDirPickerLines(state, 50, 20)
    const content = lines.join("\n")
    expect(content).toContain("> new-feature█")

    // Press Enter - should use as relative path since no matches
    const result = handleDirPickerKey(state, "\r")
    expect(result.action).toBe("select")
    if (result.action === "select") {
      expect(result.path).toBe("/home/user/myapp/new-feature")
    }
  })
})
