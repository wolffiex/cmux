import { beforeEach, describe, expect, test } from "bun:test";
import {
  _clearAll,
  getAllFrequencies,
  getFrequencies,
  recordSelection,
} from "../src/picker-store";

beforeEach(() => {
  _clearAll();
});

describe("picker frequency tracking", () => {
  test("recordSelection increments count per layout", () => {
    recordSelection("50/50", "dir", "/Users/test/home");
    recordSelection("50/50", "dir", "/Users/test/home");
    recordSelection("50/50", "dir", "/Users/test/home");

    const freqs = getFrequencies("50/50", "dir");
    const home = freqs.find((f) => f.key === "/Users/test/home");
    expect(home).toBeDefined();
    expect(home?.count).toBe(3);
  });

  test("most selected item comes first", () => {
    // Select "other" once
    recordSelection("full", "dir", "/Users/test/other");

    // Select "home" three times
    recordSelection("full", "dir", "/Users/test/home");
    recordSelection("full", "dir", "/Users/test/home");
    recordSelection("full", "dir", "/Users/test/home");

    const freqs = getFrequencies("full", "dir");
    expect(freqs.length).toBe(2);
    expect(freqs[0].key).toBe("/Users/test/home");
    expect(freqs[1].key).toBe("/Users/test/other");
  });

  test("getAllFrequencies returns all types mixed, ordered by count", () => {
    recordSelection("50/50", "repo", "/Users/test/code/cmux");
    recordSelection("50/50", "dir", "/Users/test/home");
    recordSelection("50/50", "dir", "/Users/test/home");
    recordSelection("50/50", "host", "devbox");

    const all = getAllFrequencies("50/50");
    expect(all.length).toBe(3);
    // home has count 2, others have count 1
    expect(all[0].key).toBe("/Users/test/home");
    expect(all[0].type).toBe("dir");
  });

  test("different layouts are independent", () => {
    recordSelection("50/50", "repo", "/code/foo");
    recordSelection("50/50", "repo", "/code/foo");
    recordSelection("full", "repo", "/code/foo");

    const fiftyFifty = getFrequencies("50/50", "repo");
    const full = getFrequencies("full", "repo");

    expect(fiftyFifty[0].count).toBe(2);
    expect(full[0].count).toBe(1);
  });

  test("different hosts are independent", () => {
    recordSelection("full", "repo", "/code/foo", "local");
    recordSelection("full", "repo", "/code/foo", "local");
    recordSelection("full", "repo", "/code/foo", "devbox");

    const local = getFrequencies("full", "repo", "local");
    const devbox = getFrequencies("full", "repo", "devbox");

    expect(local[0].count).toBe(2);
    expect(devbox[0].count).toBe(1);
  });
});
