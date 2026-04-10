import "./test-db-isolate";
import { beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "../src/db";
import { getRankedTransitions, recordTransition } from "../src/layout-store";

beforeEach(() => {
  // Touch getRankedTransitions first so ensureTable() runs and creates
  // the `transitions` table on a fresh isolated DB before we DELETE.
  getRankedTransitions("__init__");
  getDb().run("DELETE FROM transitions");
});

describe("getRankedTransitions", () => {
  test("directional: A→B ranks B from A but does NOT rank A from B", () => {
    recordTransition("A", "B");
    recordTransition("A", "B");

    const fromA = getRankedTransitions("A");
    const fromB = getRankedTransitions("B");

    expect(fromA).toEqual([{ name: "B", count: 2 }]);
    // B has no outgoing transitions — the reverse edge A→B must not leak in.
    expect(fromB).toEqual([]);
  });

  test("directional: A→B and B→A are tracked separately", () => {
    recordTransition("A", "B");
    recordTransition("A", "B");
    recordTransition("A", "B");
    recordTransition("B", "A");

    expect(getRankedTransitions("A")).toEqual([{ name: "B", count: 3 }]);
    expect(getRankedTransitions("B")).toEqual([{ name: "A", count: 1 }]);
  });

  test("descending order by combined count", () => {
    recordTransition("X", "Y");
    recordTransition("X", "Y");
    recordTransition("X", "Y");
    recordTransition("X", "Z");

    const ranked = getRankedTransitions("X");
    expect(ranked[0]?.name).toBe("Y");
    expect(ranked[0]?.count).toBe(3);
    expect(ranked[1]?.name).toBe("Z");
    expect(ranked[1]?.count).toBe(1);
  });

  test("ties broken deterministically by name", () => {
    recordTransition("X", "B");
    recordTransition("X", "A");
    recordTransition("X", "C");

    const ranked = getRankedTransitions("X");
    expect(ranked.map((r) => r.name)).toEqual(["A", "B", "C"]);
  });

  test("recordTransition refuses self-loops", () => {
    recordTransition("A", "A");
    const ranked = getRankedTransitions("A");
    expect(ranked).toEqual([]);
  });

  test("getRankedTransitions filters pre-existing self-loop rows", () => {
    // Bypass recordTransition's guard to simulate a row written before
    // the guard existed. The read path must not return self-loops.
    getDb().run(
      `INSERT INTO transitions (from_layout, to_layout, count) VALUES (?, ?, ?)`,
      ["A", "A", 5],
    );
    recordTransition("A", "B");

    const ranked = getRankedTransitions("A");
    // Only B should appear; A→A must be excluded.
    expect(ranked).toEqual([{ name: "B", count: 1 }]);
  });
});
