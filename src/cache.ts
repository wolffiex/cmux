import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function getCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(xdgCache, "cmux");
}

export class Cache<T> {
  private db: Database;
  private ttlMs: number;

  private getStmt: ReturnType<Database["prepare"]>;
  private setStmt: ReturnType<Database["prepare"]>;
  private deleteStmt: ReturnType<Database["prepare"]>;
  private existsStmt: ReturnType<Database["prepare"]>;
  private clearStmt: ReturnType<Database["prepare"]>;
  private pruneStmt: ReturnType<Database["prepare"]>;

  constructor(name: string, ttlMs: number = 30 * 60 * 1000) {
    const cacheDir = getCacheDir();
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    this.db = new Database(join(cacheDir, `${name}.sqlite`), { create: true });
    this.ttlMs = ttlMs;

    // Enable WAL mode for better performance
    this.db.run("PRAGMA journal_mode = WAL");

    // Create table if not exists
    this.db.run(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);

    // Create index for expiry queries
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_expires_at ON cache(expires_at)
    `);

    // Prepare statements
    this.getStmt = this.db.prepare(
      "SELECT value, expires_at FROM cache WHERE key = ?"
    );
    this.setStmt = this.db.prepare(
      "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)"
    );
    this.deleteStmt = this.db.prepare("DELETE FROM cache WHERE key = ?");
    this.existsStmt = this.db.prepare(
      "SELECT 1 FROM cache WHERE key = ? AND expires_at > ?"
    );
    this.clearStmt = this.db.prepare("DELETE FROM cache");
    this.pruneStmt = this.db.prepare("DELETE FROM cache WHERE expires_at <= ?");
  }

  /**
   * Get a value from cache, or compute it using the factory if missing/expired.
   */
  async get(key: string, factory: () => Promise<T>): Promise<T> {
    const row = this.getStmt.get(key) as
      | { value: string; expires_at: number }
      | null;
    const now = Date.now();

    if (row && row.expires_at > now) {
      return JSON.parse(row.value) as T;
    }

    const value = await factory();
    this.setStmt.run(key, JSON.stringify(value), now + this.ttlMs);

    return value;
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean {
    const row = this.existsStmt.get(key, Date.now());
    return row !== null;
  }

  /**
   * Get a value if it exists and is not expired, without computing.
   */
  peek(key: string): T | undefined {
    const row = this.getStmt.get(key) as
      | { value: string; expires_at: number }
      | null;
    if (row && row.expires_at > Date.now()) {
      return JSON.parse(row.value) as T;
    }
    return undefined;
  }

  /**
   * Manually set a value in the cache.
   */
  set(key: string, value: T): void {
    this.setStmt.run(key, JSON.stringify(value), Date.now() + this.ttlMs);
  }

  /**
   * Invalidate a specific key.
   */
  invalidate(key: string): void {
    this.deleteStmt.run(key);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.clearStmt.run();
  }

  /**
   * Remove all expired entries.
   */
  prune(): void {
    this.pruneStmt.run(Date.now());
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
