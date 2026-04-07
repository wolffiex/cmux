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
  test("recordSelection increments count", () => {
    recordSelection("dir", "/Users/test/home");
    recordSelection("dir", "/Users/test/home");
    recordSelection("dir", "/Users/test/home");

    const freqs = getFrequencies("dir");
    const home = freqs.find((f) => f.key === "/Users/test/home");
    expect(home).toBeDefined();
    expect(home?.count).toBe(3);
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
