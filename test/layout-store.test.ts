import { beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "../src/db";
import { getRankedTransitions, recordTransition } from "../src/layout-store";

beforeEach(() => {
  getDb().run("DELETE FROM transitions");
});

describe("getRankedTransitions", () => {
  test("symmetric: A→B biases ranking from both A and B", () => {
    recordTransition("A", "B");
    recordTransition("A", "B");

    const fromA = getRankedTransitions("A");
    const fromB = getRankedTransitions("B");

    expect(fromA[0]?.name).toBe("B");
    expect(fromA[0]?.count).toBe(2);
    expect(fromB[0]?.name).toBe("A");
    expect(fromB[0]?.count).toBe(2);
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
    // the guard existed. The read path must not return self-loops or
    // double-count them via the symmetric union.
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
