import { test, expect, describe } from "bun:test";
import { getWindowName, generateSummary, getSummary, getSummariesForWindows } from "../src/summaries";
import type { WindowContext } from "../src/tmux";

describe("getWindowName", () => {
  test("returns repo name for main branch", () => {
    expect(getWindowName("/code/claude-code", "main")).toBe("claude-code");
  });

  test("returns repo name for master branch", () => {
    expect(getWindowName("/code/claude-code", "master")).toBe("claude-code");
  });

  test("returns repo name for develop branch", () => {
    expect(getWindowName("/code/api", "develop")).toBe("api");
  });

  test("returns repo name for dev branch", () => {
    expect(getWindowName("/code/api", "dev")).toBe("api");
  });

  test("returns repo name when branch is null", () => {
    expect(getWindowName("/code/claude-code", null)).toBe("claude-code");
  });

  test("extracts short branch from fix/ prefix", () => {
    // Note: truncated to 15 chars
    expect(getWindowName("/code/claude-code", "fix/npmrc-registry")).toBe("claude-code/npm");
  });

  test("extracts short branch from feature/ prefix", () => {
    // Note: truncated to 15 chars
    expect(getWindowName("/code/api", "feature/PROJ-123-desc")).toBe("api/PROJ-123-de");
  });

  test("extracts short branch from nested prefix", () => {
    expect(getWindowName("/code/api", "user/alice/experiment")).toBe("api/experiment");
  });

  test("truncates long names to 15 chars", () => {
    const name = getWindowName("/code/api", "feature/very-long-branch-name");
    expect(name.length).toBeLessThanOrEqual(15);
    expect(name).toBe("api/very-long-b");
  });

  test("preserves repo name during truncation", () => {
    const name = getWindowName("/code/myrepo", "fix/some-branch");
    expect(name.startsWith("myrepo/")).toBe(true);
  });

  test("handles empty workdir", () => {
    expect(getWindowName("", "main")).toBe("shell");
  });

  test("handles non-feature branch without slash", () => {
    expect(getWindowName("/code/api", "hotfix-123")).toBe("api/hotfix-123");
  });
});

describe("generateSummary", () => {
  test("uses active pane for context", () => {
    const context: WindowContext = {
      windowIndex: 0,
      windowName: "test",
      panes: [
        { workdir: "/code/repo1", program: "zsh", transcript: "", gitBranch: "main" },
        { workdir: "/code/repo2", program: "vim", transcript: "", gitBranch: "feature/cool-thing" },
      ],
      activePaneIndex: 1, // Second pane is active
    };

    const name = generateSummary(context);
    // Note: truncated to 15 chars
    expect(name).toBe("repo2/cool-thin");
  });

  test("falls back to first pane when activePaneIndex is invalid", () => {
    const context: WindowContext = {
      windowIndex: 0,
      windowName: "test",
      panes: [
        { workdir: "/code/repo1", program: "zsh", transcript: "", gitBranch: "main" },
      ],
      activePaneIndex: 99, // Invalid index
    };

    const name = generateSummary(context);
    expect(name).toBe("repo1");
  });

  test("returns window name when no panes", () => {
    const context: WindowContext = {
      windowIndex: 0,
      windowName: "fallback-name",
      panes: [],
      activePaneIndex: 0,
    };

    const name = generateSummary(context);
    expect(name).toBe("fallback-name");
  });
});

describe("getSummary with caching", () => {
  test("returns cached value when context hash matches", () => {
    const context: WindowContext = {
      windowIndex: 42,
      windowName: "test",
      panes: [
        { workdir: "/code/myrepo", program: "zsh", transcript: "", gitBranch: "fix/bug" },
      ],
      activePaneIndex: 0,
    };

    // First call - generates new summary
    const first = getSummary(context);
    expect(first).toBe("myrepo/bug");

    // Second call with same context - should return cached
    const second = getSummary(context);
    expect(second).toBe("myrepo/bug");
  });
});

describe("getSummariesForWindows", () => {
  test("returns map of window index to name", () => {
    const contexts: WindowContext[] = [
      {
        windowIndex: 0,
        windowName: "w0",
        panes: [{ workdir: "/code/alpha", program: "zsh", transcript: "", gitBranch: "main" }],
        activePaneIndex: 0,
      },
      {
        windowIndex: 1,
        windowName: "w1",
        panes: [{ workdir: "/code/beta", program: "vim", transcript: "", gitBranch: "fix/issue" }],
        activePaneIndex: 0,
      },
    ];

    const summaries = getSummariesForWindows(contexts);

    expect(summaries.get(0)).toBe("alpha");
    expect(summaries.get(1)).toBe("beta/issue");
  });
});
