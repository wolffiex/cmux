import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFilter,
  getResults,
  matchesFilter,
  updateFilter,
} from "./resumable-filter";

// ── Test Fixtures ────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `cmux-filter-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });

  // Create directory structure:
  // testDir/
  //   code/
  //     cmux/
  //     beatzero/
  //       examples/
  //   projects/
  //     webapp/
  //   .hidden/
  //   node_modules/
  //     some-package/

  mkdirSync(join(testDir, "code/cmux"), { recursive: true });
  mkdirSync(join(testDir, "code/beatzero/examples"), { recursive: true });
  mkdirSync(join(testDir, "projects/webapp"), { recursive: true });
  mkdirSync(join(testDir, ".hidden"), { recursive: true });
  mkdirSync(join(testDir, "node_modules/some-package"), { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ── matchesFilter tests ──────────────────────────────────────────────────────

describe("matchesFilter", () => {
  test("empty filter matches everything", () => {
    expect(matchesFilter("/home/user/code", "")).toBe(true);
  });

  test("exact segment match", () => {
    expect(matchesFilter("/home/user/code", "code")).toBe(true);
  });

  test("prefix match within segment", () => {
    expect(matchesFilter("/home/user/code", "cod")).toBe(true);
  });

  test("multi-segment fuzzy match", () => {
    expect(matchesFilter("/home/user/code/beatzero", "codebeat")).toBe(true);
  });

  test("substring match within segment", () => {
    expect(matchesFilter("/home/user/code/beatzero/examples", "codebex")).toBe(
      true,
    );
  });

  test("no match returns false", () => {
    expect(matchesFilter("/home/user/code", "xyz")).toBe(false);
  });

  test("case insensitive", () => {
    expect(matchesFilter("/home/user/Code", "code")).toBe(true);
    expect(matchesFilter("/home/user/code", "CODE")).toBe(true);
  });
});

// ── createFilter tests ───────────────────────────────────────────────────────

describe("createFilter", () => {
  test("creates filter with initial results", () => {
    const filter = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 100 },
      "",
    );

    const results = getResults(filter);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toBe(testDir); // Root itself is first
  });

  test("filters results by needle", () => {
    const filter = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 100 },
      "code",
    );

    const results = getResults(filter);
    expect(results.every((d) => matchesFilter(d, "code"))).toBe(true);
    expect(results.some((d) => d.includes("/code"))).toBe(true);
  });

  test("respects limit", () => {
    const filter = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 2 },
      "",
    );

    const results = getResults(filter);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("skips hidden directories", () => {
    const filter = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 100 },
      "",
    );

    const results = getResults(filter);
    expect(results.some((d) => d.includes(".hidden"))).toBe(false);
  });

  test("skips node_modules", () => {
    const filter = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 100 },
      "",
    );

    const results = getResults(filter);
    expect(results.some((d) => d.includes("node_modules"))).toBe(false);
  });

  test("marks complete when all directories found", () => {
    const filter = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 100 },
      "",
    );

    // With high limit and small test dir, should be complete
    expect(filter.complete).toBe(true);
  });

  test("marks incomplete when limit reached", () => {
    const filter = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 2 },
      "",
    );

    // With low limit, should hit limit before exhausting dirs
    expect(filter.complete).toBe(false);
  });
});

// ── updateFilter tests ───────────────────────────────────────────────────────

describe("updateFilter", () => {
  test("narrows results when needle extends", () => {
    const filter1 = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 100 },
      "c",
    );
    const filter2 = updateFilter(filter1, "code");

    const results1 = getResults(filter1);
    const results2 = getResults(filter2);

    // Results should narrow
    expect(results2.length).toBeLessThanOrEqual(results1.length);
    expect(results2.every((d) => matchesFilter(d, "code"))).toBe(true);
  });

  test("preserves needle when extending", () => {
    const filter1 = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 100 },
      "co",
    );
    const filter2 = updateFilter(filter1, "code");

    expect(filter2.needle).toBe("code");
  });

  test("creates fresh filter when needle doesn't extend", () => {
    const filter1 = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 100 },
      "code",
    );
    const filter2 = updateFilter(filter1, "proj");

    // Should have completely different results
    const results2 = getResults(filter2);
    expect(results2.every((d) => matchesFilter(d, "proj"))).toBe(true);
    expect(filter2.needle).toBe("proj");
  });

  test("resumes scanning when narrowing needs more results", () => {
    // Create filter with low limit - will be incomplete
    const filter1 = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 3 },
      "",
    );
    expect(filter1.complete).toBe(false);

    // Narrow with filter that matches fewer - should resume to find more
    const filter2 = updateFilter(filter1, "code");
    const results = getResults(filter2);

    // Should have found code-matching directories
    expect(results.some((d) => d.includes("/code"))).toBe(true);
  });

  test("handles backspace (shorter filter) as fresh search", () => {
    const filter1 = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 100 },
      "code",
    );
    // Typing backspace would go from "code" to "cod" - not an extension
    const filter2 = updateFilter(filter1, "cod");

    // "cod" doesn't start with "code", so fresh search
    expect(filter2.needle).toBe("cod");
    const results = getResults(filter2);
    expect(results.some((d) => d.includes("/code"))).toBe(true);
  });
});

// ── Integration tests ────────────────────────────────────────────────────────

describe("breadth-first ordering", () => {
  test("shallower matches come before deeper matches", () => {
    // Create structure:
    // testDir/
    //   aaa/
    //     src/
    //       cmux/   <- depth 3, matches "srccmux"
    //   src/
    //     cmux/     <- depth 2, matches "srccmux"
    mkdirSync(join(testDir, "aaa/src/cmux"), { recursive: true });
    mkdirSync(join(testDir, "src/cmux"), { recursive: true });

    const filter = createFilter(
      { roots: [testDir], maxDepth: 4, limit: 100 },
      "srccmux",
    );

    const results = getResults(filter);

    // Should find both
    expect(results.some((d) => d.endsWith("/src/cmux"))).toBe(true);

    // The shallower one (testDir/src/cmux) should come BEFORE the deeper one (testDir/aaa/src/cmux)
    const shallowIndex = results.findIndex(
      (d) => d === join(testDir, "src/cmux"),
    );
    const deepIndex = results.findIndex(
      (d) => d === join(testDir, "aaa/src/cmux"),
    );

    expect(shallowIndex).toBeGreaterThanOrEqual(0);
    expect(deepIndex).toBeGreaterThanOrEqual(0);
    expect(shallowIndex).toBeLessThan(deepIndex);
  });

  test("alphabetically later but shallower dir comes first", () => {
    // Create structure:
    // testDir/
    //   aaa/
    //     zzz/     <- depth 2, alphabetically first parent
    //   zzz/       <- depth 1, alphabetically last at this level
    mkdirSync(join(testDir, "aaa/zzz"), { recursive: true });
    mkdirSync(join(testDir, "zzz"), { recursive: true });

    const filter = createFilter(
      { roots: [testDir], maxDepth: 4, limit: 100 },
      "zzz",
    );

    const results = getResults(filter);

    // testDir/zzz (depth 1) should come before testDir/aaa/zzz (depth 2)
    const shallowIndex = results.findIndex((d) => d === join(testDir, "zzz"));
    const deepIndex = results.findIndex((d) => d === join(testDir, "aaa/zzz"));

    expect(shallowIndex).toBeGreaterThanOrEqual(0);
    expect(deepIndex).toBeGreaterThanOrEqual(0);
    expect(shallowIndex).toBeLessThan(deepIndex);
  });

  test("progressive typing maintains BFS order", () => {
    // Create structure where progressive narrowing could break BFS order.
    // The key is that when we resume scanning after narrowing, deeper directories
    // in the pending queue shouldn't be returned before shallower matches.
    //
    // Structure:
    // testDir/
    //   aaa/           <- many children here to fill initial results and pending queue
    //     bbb01/ bbb02/ ... bbb25/
    //       deep/
    //         myrepo/  <- depth 4, matches "myrepo"
    //   zzz/           <- alphabetically last, so processed later
    //     myrepo/      <- depth 2, matches "myrepo"
    //
    // When initial scan runs with limit 20, it will:
    // 1. Add testDir, aaa, zzz (depth 0-1) to results
    // 2. Process aaa first (alphabetically), adding bbb01-bbb25 to pending and results
    // 3. Hit limit before processing zzz's children or going deeper
    //
    // When we narrow to "myrepo", none of the initial results match.
    // Resume scanning should process remaining pending items, but should still
    // return shallower matches (zzz/myrepo depth 2) before deeper ones (aaa/bbb01/deep/myrepo depth 4).

    // Create many directories - more than limit to ensure we hit the limit mid-scan
    for (let i = 1; i <= 25; i++) {
      mkdirSync(join(testDir, `aaa/bbb${i.toString().padStart(2, "0")}`), {
        recursive: true,
      });
    }
    // Create the deep match
    mkdirSync(join(testDir, "aaa/bbb01/deep/myrepo"), { recursive: true });
    // Create the shallow match (alphabetically last at depth 1)
    mkdirSync(join(testDir, "zzz/myrepo"), { recursive: true });

    // Start with empty filter (as repo-picker does)
    let filter = createFilter(
      { roots: [testDir], maxDepth: 5, limit: 20 },
      "",
    );

    // Progressively type "myrepo"
    for (const char of "myrepo") {
      filter = updateFilter(filter, filter.needle + char);
    }

    const results = getResults(filter);

    // Should find both matches
    const shallowMatch = join(testDir, "zzz/myrepo");
    const deepMatch = join(testDir, "aaa/bbb01/deep/myrepo");

    const shallowIndex = results.findIndex((d) => d === shallowMatch);
    const deepIndex = results.findIndex((d) => d === deepMatch);

    // Both should be found
    expect(shallowIndex).toBeGreaterThanOrEqual(0);
    expect(deepIndex).toBeGreaterThanOrEqual(0);

    // The shallower one (depth 2) should come before the deeper one (depth 4)
    expect(shallowIndex).toBeLessThan(deepIndex);
  });

  test("alphabetically later children are found when limit is reached mid-directory", () => {
    // This tests a specific bug: when scanning a directory with many children,
    // hitting the result limit mid-directory causes alphabetically later children
    // to never be added to the pending queue, so they're never found.
    //
    // Structure:
    // testDir/
    //   parent/
    //     aaa/ bbb/ ccc/ ... (many dirs to hit limit)
    //     zzz/   <- alphabetically last, should still be found
    //
    // The fix ensures all children are added to pending before checking limit.

    // Create parent with many children + one target at the end alphabetically
    for (let i = 1; i <= 25; i++) {
      mkdirSync(join(testDir, `parent/child${i.toString().padStart(2, "0")}`), {
        recursive: true,
      });
    }
    mkdirSync(join(testDir, "parent/zzztarget"), { recursive: true });

    // Start with empty filter and low limit
    let filter = createFilter(
      { roots: [testDir], maxDepth: 3, limit: 10 },
      "",
    );

    // Type "zzz" to filter to just the target
    for (const char of "zzz") {
      filter = updateFilter(filter, filter.needle + char);
    }

    const results = getResults(filter);
    const targetPath = join(testDir, "parent/zzztarget");

    // The target should be found even though it comes late alphabetically
    expect(results).toContain(targetPath);
  });
});

describe("progressive typing", () => {
  test("typing c -> co -> code progressively narrows", () => {
    const opts = { roots: [testDir], maxDepth: 3, limit: 100 };

    let filter = createFilter(opts, "c");
    const resultsC = getResults(filter);

    filter = updateFilter(filter, "co");
    const resultsCo = getResults(filter);

    filter = updateFilter(filter, "code");
    const resultsCode = getResults(filter);

    // Each step should narrow (or stay same)
    expect(resultsCo.length).toBeLessThanOrEqual(resultsC.length);
    expect(resultsCode.length).toBeLessThanOrEqual(resultsCo.length);

    // All should match their respective filters
    expect(resultsCode.every((d) => matchesFilter(d, "code"))).toBe(true);
  });

  test("fuzzy path search finds nested directories", () => {
    const filter = createFilter(
      { roots: [testDir], maxDepth: 4, limit: 100 },
      "codebeatex",
    );

    const results = getResults(filter);
    expect(results.some((d) => d.endsWith("/examples"))).toBe(true);
  });

  test("home directory is first when no filter", () => {
    const home = process.env.HOME || "/home";
    const filter = createFilter({ roots: [home], maxDepth: 1, limit: 10 }, "");

    const results = getResults(filter);
    expect(results[0]).toBe(home);
  });
});
