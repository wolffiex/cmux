import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findLongestPrefixCache,
  getDirsForFilter,
  initDirSearch,
  matchesFilter,
  walkDirs,
} from "./dir-search";

// ── Test Fixtures ────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  // Create a temp directory structure for testing
  testDir = join(tmpdir(), `cmux-test-${Date.now()}`);
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
    expect(matchesFilter("anything", "")).toBe(true);
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

// ── walkDirs generator tests ─────────────────────────────────────────────────

describe("walkDirs", () => {
  test("yields directories breadth-first", () => {
    const dirs = [...walkDirs([testDir], 3, "")];

    // Should find code, projects at depth 1 first
    const codeIdx = dirs.findIndex((d) => d.endsWith("/code"));
    const projectsIdx = dirs.findIndex((d) => d.endsWith("/projects"));
    const cmuxIdx = dirs.findIndex((d) => d.endsWith("/cmux"));

    // Depth 1 dirs should come before depth 2 dirs
    expect(codeIdx).toBeLessThan(cmuxIdx);
    expect(projectsIdx).toBeLessThan(cmuxIdx);
  });

  test("skips hidden directories", () => {
    const dirs = [...walkDirs([testDir], 3, "")];
    expect(dirs.some((d) => d.includes(".hidden"))).toBe(false);
  });

  test("skips node_modules", () => {
    const dirs = [...walkDirs([testDir], 3, "")];
    expect(dirs.some((d) => d.includes("node_modules"))).toBe(false);
  });

  test("respects maxDepth", () => {
    const depth1 = [...walkDirs([testDir], 1, "")];
    const depth3 = [...walkDirs([testDir], 3, "")];

    // Depth 1 shouldn't find nested examples dir
    expect(depth1.some((d) => d.endsWith("/examples"))).toBe(false);
    // Depth 3 should find it
    expect(depth3.some((d) => d.endsWith("/examples"))).toBe(true);
  });

  test("filters results by filter string", () => {
    const dirs = [...walkDirs([testDir], 3, "beat")];

    // Should only return dirs matching "beat"
    expect(dirs.every((d) => matchesFilter(d, "beat"))).toBe(true);
    expect(dirs.some((d) => d.includes("beatzero"))).toBe(true);
  });

  test("handles permission errors gracefully", () => {
    // Searching a non-existent directory shouldn't throw
    const dirs = [...walkDirs(["/nonexistent-path-12345"], 2, "")];
    expect(dirs).toEqual([]);
  });
});

// ── Cache tests ──────────────────────────────────────────────────────────────

describe("findLongestPrefixCache", () => {
  test("returns null for empty cache", () => {
    const cache = new Map();
    expect(findLongestPrefixCache(cache, "code")).toBe(null);
  });

  test("finds exact match", () => {
    const cache = new Map([["code", { dirs: ["/code"], complete: true }]]);
    const result = findLongestPrefixCache(cache, "code");
    expect(result?.prefix).toBe("code");
  });

  test("finds longest prefix", () => {
    const cache = new Map([
      ["c", { dirs: ["/c"], complete: true }],
      ["co", { dirs: ["/co"], complete: true }],
      ["cod", { dirs: ["/cod"], complete: true }],
    ]);
    const result = findLongestPrefixCache(cache, "code");
    expect(result?.prefix).toBe("cod");
  });

  test("returns null when no prefix matches", () => {
    const cache = new Map([["xyz", { dirs: ["/xyz"], complete: true }]]);
    expect(findLongestPrefixCache(cache, "code")).toBe(null);
  });
});

describe("getDirsForFilter", () => {
  test("returns directories matching filter", () => {
    const state = initDirSearch({
      roots: [testDir],
      maxDepth: 3,
      limit: 100,
    });

    const { dirs } = getDirsForFilter(state, "code");
    expect(dirs.some((d) => d.endsWith("/code"))).toBe(true);
  });

  test("caches results for reuse", () => {
    const state = initDirSearch({
      roots: [testDir],
      maxDepth: 3,
      limit: 100,
    });

    const { state: state2 } = getDirsForFilter(state, "code");
    expect(state2.cache.has("code")).toBe(true);
  });

  test("uses cache on subsequent calls", () => {
    const state = initDirSearch({
      roots: [testDir],
      maxDepth: 3,
      limit: 100,
    });

    const { state: state2 } = getDirsForFilter(state, "code");
    const { dirs } = getDirsForFilter(state2, "code");

    // Should return same results from cache
    expect(dirs.some((d) => d.endsWith("/code"))).toBe(true);
  });

  test("uses prefix cache for longer filters", () => {
    const state = initDirSearch({
      roots: [testDir],
      maxDepth: 3,
      limit: 100,
    });

    // Search for "co" first
    const { state: state2 } = getDirsForFilter(state, "co");

    // Then search for "code" - should use "co" cache
    const { state: state3, dirs } = getDirsForFilter(state2, "code");

    expect(dirs.some((d) => d.endsWith("/code"))).toBe(true);
    expect(state3.cache.has("code")).toBe(true);
  });

  test("respects limit", () => {
    const state = initDirSearch({
      roots: [testDir],
      maxDepth: 3,
      limit: 2,
    });

    const { dirs } = getDirsForFilter(state, "");
    expect(dirs.length).toBeLessThanOrEqual(2);
  });

  test("home directory itself is first result when no filter", () => {
    const home = process.env.HOME || "/home";
    const state = initDirSearch({
      roots: [home],
      maxDepth: 1,
      limit: 10,
    });

    const { dirs } = getDirsForFilter(state, "");
    // First result should be ~ itself
    expect(dirs[0]).toBe(home);
  });
});

// ── Integration tests ────────────────────────────────────────────────────────

describe("progressive search", () => {
  test("typing more characters refines results", () => {
    const state = initDirSearch({
      roots: [testDir],
      maxDepth: 3,
      limit: 100,
    });

    const { dirs: dirsC, state: state2 } = getDirsForFilter(state, "c");
    const { dirs: dirsCode } = getDirsForFilter(state2, "code");

    // "code" results should be subset of "c" results
    expect(dirsCode.length).toBeLessThanOrEqual(dirsC.length);
    expect(dirsCode.every((d) => matchesFilter(d, "code"))).toBe(true);
  });

  test("fuzzy path search finds nested directories", () => {
    const state = initDirSearch({
      roots: [testDir],
      maxDepth: 4,
      limit: 100,
    });

    const { dirs } = getDirsForFilter(state, "codebeatex");

    // Should find code/beatzero/examples
    expect(dirs.some((d) => d.endsWith("/examples"))).toBe(true);
  });
});
