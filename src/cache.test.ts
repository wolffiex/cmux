import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Cache } from "./cache";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function getCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(xdgCache, "cmux");
}

function cleanupDb(name: string) {
  const cacheDir = getCacheDir();
  const dbPath = join(cacheDir, `${name}.sqlite`);
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;

  for (const path of [dbPath, walPath, shmPath]) {
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // ignore
      }
    }
  }
}

describe("Cache", () => {
  const testDbName = "test-cache";
  let cache: Cache<string>;

  beforeEach(() => {
    cleanupDb(testDbName);
    cache = new Cache<string>(testDbName, 100); // 100ms TTL for fast tests
  });

  afterEach(() => {
    cache.close();
    cleanupDb(testDbName);
  });

  it("should compute and cache value on first access", async () => {
    let computeCount = 0;
    const factory = async () => {
      computeCount++;
      return "computed";
    };

    const result = await cache.get("key", factory);
    expect(result).toBe("computed");
    expect(computeCount).toBe(1);

    // Second access should use cache
    const result2 = await cache.get("key", factory);
    expect(result2).toBe("computed");
    expect(computeCount).toBe(1);
  });

  it("should recompute after TTL expires", async () => {
    let computeCount = 0;
    const factory = async () => {
      computeCount++;
      return `computed-${computeCount}`;
    };

    const result1 = await cache.get("key", factory);
    expect(result1).toBe("computed-1");

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result2 = await cache.get("key", factory);
    expect(result2).toBe("computed-2");
    expect(computeCount).toBe(2);
  });

  it("should support has() to check existence", async () => {
    expect(cache.has("key")).toBe(false);

    await cache.get("key", async () => "value");
    expect(cache.has("key")).toBe(true);

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(cache.has("key")).toBe(false);
  });

  it("should support peek() without computing", async () => {
    expect(cache.peek("key")).toBeUndefined();

    await cache.get("key", async () => "value");
    expect(cache.peek("key")).toBe("value");
  });

  it("should support manual set()", () => {
    cache.set("key", "manual");
    expect(cache.peek("key")).toBe("manual");
  });

  it("should support invalidate()", async () => {
    await cache.get("key", async () => "value");
    expect(cache.has("key")).toBe(true);

    cache.invalidate("key");
    expect(cache.has("key")).toBe(false);
  });

  it("should support clear()", async () => {
    await cache.get("key1", async () => "value1");
    await cache.get("key2", async () => "value2");

    cache.clear();
    expect(cache.has("key1")).toBe(false);
    expect(cache.has("key2")).toBe(false);
  });

  it("should support prune() to remove expired entries", async () => {
    cache.set("key1", "value1");

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Add a fresh entry
    cache.set("key2", "value2");

    cache.prune();

    expect(cache.has("key1")).toBe(false);
    expect(cache.has("key2")).toBe(true);
  });

  it("should persist data across instances", async () => {
    await cache.get("persistent-key", async () => "persistent-value");
    cache.close();

    // Create new instance with same name
    const cache2 = new Cache<string>(testDbName, 100);
    expect(cache2.peek("persistent-key")).toBe("persistent-value");
    cache2.close();

    // Reassign for cleanup in afterEach
    cache = new Cache<string>(testDbName, 100);
  });

  it("should handle complex objects", async () => {
    const complexCache = new Cache<{ name: string; items: number[] }>(
      "test-complex",
      100
    );

    const obj = { name: "test", items: [1, 2, 3] };
    await complexCache.get("obj", async () => obj);

    const retrieved = complexCache.peek("obj");
    expect(retrieved).toEqual(obj);

    complexCache.close();
    cleanupDb("test-complex");
  });

  it("should use 30 minute default TTL", async () => {
    const defaultCache = new Cache<string>("test-default");
    let computeCount = 0;

    await defaultCache.get("key", async () => {
      computeCount++;
      return "value";
    });

    // Should still be cached (no 30 min wait in test)
    await defaultCache.get("key", async () => {
      computeCount++;
      return "value2";
    });

    expect(computeCount).toBe(1);

    defaultCache.close();
    cleanupDb("test-default");
  });
});
