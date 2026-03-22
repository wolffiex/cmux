import { beforeEach, describe, expect, test } from "bun:test";
import {
  getAllFrequencies,
  getFrequencies,
  recordSelection,
  _clearAll,
} from "../src/picker-store";

beforeEach(() => {
  _clearAll();
});

describe("picker frequency tracking", () => {
  test("recordSelection increments count", () => {
    recordSelection("dir", "/Users/test/home");
    recordSelection("dir", "/Users/test/home");
    recordSelection("dir", "/Users/test/home");

    const freqs = getFrequencies("dir");
    const home = freqs.find((f) => f.key === "/Users/test/home");
    expect(home).toBeDefined();
    expect(home!.count).toBe(3);
  });

  test("most selected item comes first", () => {
    // Select "other" once
    recordSelection("dir", "/Users/test/other");

    // Select "home" three times
    recordSelection("dir", "/Users/test/home");
    recordSelection("dir", "/Users/test/home");
    recordSelection("dir", "/Users/test/home");

    const freqs = getFrequencies("dir");
    expect(freqs.length).toBe(2);
    expect(freqs[0].key).toBe("/Users/test/home");
    expect(freqs[1].key).toBe("/Users/test/other");
  });

  test("getAllFrequencies returns all types mixed, ordered by count", () => {
    recordSelection("repo", "/Users/test/code/cmux");
    recordSelection("dir", "/Users/test/home");
    recordSelection("dir", "/Users/test/home");
    recordSelection("host", "devbox");

    const all = getAllFrequencies();
    expect(all.length).toBe(3);
    // home has count 2, others have count 1
    expect(all[0].key).toBe("/Users/test/home");
    expect(all[0].type).toBe("dir");
  });

  test("different hosts are independent", () => {
    recordSelection("repo", "/code/foo", "local");
    recordSelection("repo", "/code/foo", "local");
    recordSelection("repo", "/code/foo", "devbox");

    const local = getFrequencies("repo", "local");
    const devbox = getFrequencies("repo", "devbox");

    expect(local[0].count).toBe(2);
    expect(devbox[0].count).toBe(1);
  });
});

describe("picker integration: frequency affects ordering", () => {
  test("selecting an item and reopening picker should show it first", () => {
    // Simulate: user opens picker, sees items in some order.
    // They select "home". Next time they open, "home" should be first.

    // Record that the user selected "home" from the directory list
    recordSelection("dir", "/Users/test/home");

    // Now get frequencies to build the picker item order
    const freqs = getFrequencies("dir");

    // "home" should be the first (and only) item with frequency data
    expect(freqs.length).toBeGreaterThan(0);
    expect(freqs[0].key).toBe("/Users/test/home");

    // Simulate selecting "home" again
    recordSelection("dir", "/Users/test/home");

    // And now also select "code" once
    recordSelection("dir", "/Users/test/code");

    // Rebuild: home should still be first (count=2 vs count=1)
    const updated = getFrequencies("dir");
    expect(updated[0].key).toBe("/Users/test/home");
    expect(updated[0].count).toBe(2);
    expect(updated[1].key).toBe("/Users/test/code");
    expect(updated[1].count).toBe(1);
  });
});

describe("picker UI uses frequency for ordering", () => {
  test("selecting a non-first directory and reopening shows it first among dirs", async () => {
    const { initRepoPicker } = await import("../src/repo-picker");

    // Open picker and get the directory items
    const picker1 = initRepoPicker();
    const dirItems1 = picker1.typeahead.items.filter((item) =>
      item.type === "dir",
    );

    if (dirItems1.length < 2) {
      // Need at least 2 directory items to test reordering — skip
      return;
    }

    // Pick the SECOND directory item (not the first)
    const secondDir = dirItems1[1];

    // Record the selection multiple times (simulating repeated use)
    recordSelection("dir", secondDir.id);
    recordSelection("dir", secondDir.id);
    recordSelection("dir", secondDir.id);

    // Reopen the picker
    const picker2 = initRepoPicker();
    const dirItems2 = picker2.typeahead.items.filter((item) =>
      item.type === "dir",
    );

    // THE FAILING ASSERTION: the frequently selected directory should now
    // be the first directory item. Currently initRepoPicker doesn't use
    // picker-store frequency data, so this will fail.
    expect(dirItems2[0].id).toBe(secondDir.id);
  });
});
