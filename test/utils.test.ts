import { describe, expect, test } from "bun:test";
import {
  sanitizeWindowName,
  splitWindowName,
  truncateName,
} from "../src/utils";

/**
 * Regression tests for long window name handling.
 *
 * The Bug We're Preventing:
 * sanitizeWindowName() previously had a 15-char limit + word-boundary cutting that destroyed names like:
 * - "research-apps/v2-rewrite" -> "research" (catastrophic truncation)
 * - The slash and everything after was lost before reaching splitWindowName
 *
 * The fix increased the limit to 50 chars so the display layer can properly handle truncation.
 */

describe("sanitizeWindowName", () => {
  test("preserves repo/branch format under 50 chars", () => {
    // These should NOT be truncated to 15 chars or cut at word boundary
    expect(sanitizeWindowName("research-apps/v2-rewrite")).toBe(
      "research-apps/v2-rewrite",
    );
    expect(sanitizeWindowName("anthropic/claude-code-internal")).toBe(
      "anthropic/claude-code-internal",
    );
    expect(sanitizeWindowName("cmux/feature-branch-name")).toBe(
      "cmux/feature-branch-name",
    );
  });

  test("preserves names up to 50 chars", () => {
    const name50 = "a".repeat(50);
    expect(sanitizeWindowName(name50)).toBe(name50);
  });

  test("truncates names over 50 chars at word boundary", () => {
    // 55 chars with hyphens
    const longName = "very-long-repo-name/extremely-long-branch-name-here";
    const sanitized = sanitizeWindowName(longName);
    expect(sanitized.length).toBeLessThanOrEqual(50);
    // Should not cut in the middle of a word
    expect(sanitized).not.toMatch(/-$/);
  });

  test("removes special characters", () => {
    expect(sanitizeWindowName('repo"name')).toBe("reponame");
    expect(sanitizeWindowName("repo'name")).toBe("reponame");
    expect(sanitizeWindowName("repo`name")).toBe("reponame");
    expect(sanitizeWindowName("repo$name")).toBe("reponame");
    expect(sanitizeWindowName("repo\\name")).toBe("reponame");
  });

  test("removes non-ASCII characters", () => {
    expect(sanitizeWindowName("repo-emoji-test")).toBe("repo-emoji-test");
  });

  test("trims whitespace", () => {
    expect(sanitizeWindowName("  repo-name  ")).toBe("repo-name");
  });
});

describe("splitWindowName (display layer)", () => {
  test("splits at first slash", () => {
    const [line1, line2] = splitWindowName("repo/branch");
    expect(line1).toBe("repo");
    expect(line2).toBe("branch");
  });

  test("handles names without slash", () => {
    const [line1, line2] = splitWindowName("just-repo-name");
    expect(line1).toBe("just-repo-name");
    expect(line2).toBe("");
  });

  test("truncates each line individually to 15 chars", () => {
    const [line1, line2] = splitWindowName(
      "very-long-repo-name/very-long-branch-name",
    );
    expect(line1.length).toBeLessThanOrEqual(15);
    expect(line2.length).toBeLessThanOrEqual(15);
    // Should have ellipsis for truncated names
    expect(line1).toContain("…");
    expect(line2).toContain("…");
    // line1 truncates from back (repo name), line2 truncates from front (branch name)
    expect(line1).toBe("very-long-repo…"); // back truncation
    expect(line2).toBe("…ng-branch-name"); // front truncation - keeps meaningful suffix
  });

  test("handles slash at start (no split)", () => {
    const [line1, line2] = splitWindowName("/branch");
    expect(line1).toBe("/branch");
    expect(line2).toBe("");
  });

  test("handles slash at end (no split)", () => {
    const [line1, line2] = splitWindowName("repo/");
    expect(line1).toBe("repo/");
    expect(line2).toBe("");
  });
});

describe("full pipeline: sanitize -> split -> truncate", () => {
  // This is the critical test that validates the complete flow

  test("long names display correctly through full pipeline", () => {
    // Simulate the exact flow that was broken
    const rawName = "research-apps/v2-rewrite";
    const sanitized = sanitizeWindowName(rawName);
    const [line1, line2] = splitWindowName(sanitized);

    // CRITICAL: Both lines must have content
    expect(line1).toBe("research-apps"); // NOT empty, NOT "research"
    expect(line2).toBe("v2-rewrite"); // NOT empty
  });

  test("regression: names that were broken before the fix", () => {
    const testCases = [
      {
        input: "research-apps/v2-rewrite",
        expectLine1: "research-apps",
        expectLine2: "v2-rewrite",
      },
      {
        input: "anthropic/claude-code",
        expectLine1: "anthropic",
        expectLine2: "claude-code",
      },
      {
        input: "cmux/feature-branch-name",
        expectLine1: "cmux",
        expectLine2: "…re-branch-name",
      },
      {
        input: "my-project/fix-bug-123",
        expectLine1: "my-project",
        expectLine2: "fix-bug-123",
      },
      {
        input: "long-repo-name/long-branch",
        expectLine1: "long-repo-name",
        expectLine2: "long-branch",
      },
    ];

    for (const { input, expectLine1, expectLine2 } of testCases) {
      const sanitized = sanitizeWindowName(input);
      const [line1, line2] = splitWindowName(sanitized);
      expect(line1).toBe(expectLine1);
      expect(line2).toBe(expectLine2);
    }
  });

  test("slash is preserved through sanitization for proper splitting", () => {
    // The key bug was that sanitization was destroying the slash before split could use it
    const testNames = [
      "repo/branch",
      "my-org/my-repo",
      "research-apps/v2-rewrite",
      "anthropic/claude-code-internal",
    ];

    for (const name of testNames) {
      const sanitized = sanitizeWindowName(name);
      // The slash MUST be preserved for splitWindowName to work
      expect(sanitized).toContain("/");

      // And splitting should produce two non-empty parts
      const [line1, line2] = splitWindowName(sanitized);
      expect(line1.length).toBeGreaterThan(0);
      expect(line2.length).toBeGreaterThan(0);
    }
  });

  test("very long repo and branch names are both visible", () => {
    const rawName = "claude-code-internal/feature-extremely-long-branch-name";
    const sanitized = sanitizeWindowName(rawName);
    const [line1, line2] = splitWindowName(sanitized);

    // Both parts should be present (truncated but not empty)
    expect(line1.length).toBeGreaterThan(0);
    expect(line2.length).toBeGreaterThan(0);

    // line1 (repo) truncates from back, line2 (branch) truncates from front
    // Note: sanitizeWindowName truncates at word boundary so "branch-name" is removed
    expect(line1).toMatch(/^claude-code/); // repo keeps start
    expect(line2).toBe("…extremely-long"); // branch keeps end after sanitization
  });
});

describe("truncateName (display layer)", () => {
  test("names 15 chars or less are unchanged", () => {
    expect(truncateName("short")).toBe("short");
    expect(truncateName("exactly15chars!")).toBe("exactly15chars!");
  });

  test("names over 15 chars get ellipsis", () => {
    expect(truncateName("this-is-too-long-name")).toBe("this-is-too-lo…");
    expect(truncateName("sixteen-chars!!!")).toBe("sixteen-chars!…");
  });

  test("truncated names are exactly 15 chars", () => {
    const truncated = truncateName("extremely-long-window-name-here");
    expect(truncated.length).toBe(15);
    expect(truncated.endsWith("…")).toBe(true);
  });
});
