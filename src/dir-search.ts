/**
 * Progressive directory search with caching.
 *
 * Uses a generator to walk directories lazily, with an LRU cache
 * keyed by filter prefix to avoid re-scanning.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DirSearchOptions {
  roots: string[];           // Starting directories (e.g., [~, /var, /etc])
  maxDepth: number;          // Maximum depth to search
  limit: number;             // Stop after finding this many matches
}

export interface DirSearchState {
  cache: Map<string, CacheEntry>;
  options: DirSearchOptions;
}

interface CacheEntry {
  dirs: string[];            // Directories found so far
  complete: boolean;         // True if search exhausted all directories
  generatorState?: GeneratorSnapshot;  // For resuming
}

interface GeneratorSnapshot {
  pending: Array<{ path: string; depth: number }>;
}

// Directories to always skip
const IGNORED_DIRS = new Set([
  "node_modules",
  "__pycache__",
  ".git",
  ".hg",
  ".svn",
  "vendor",
  "dist",
  "build",
  ".cache",
  ".npm",
  ".yarn",
  "coverage",
  ".next",
  ".nuxt",
  "target",        // Rust
  "venv",
  ".venv",
  "env",
  ".tox",
]);

// ── Fuzzy Matching ───────────────────────────────────────────────────────────

/**
 * Check if a path matches a filter using fuzzy path matching.
 */
export function matchesFilter(path: string, filter: string): boolean {
  if (!filter) return true;

  const segments = path.toLowerCase().split("/");
  const lowerFilter = filter.toLowerCase();

  let filterPos = 0;

  for (const segment of segments) {
    if (filterPos >= lowerFilter.length) break;

    const remaining = lowerFilter.slice(filterPos);
    let segStart = 0;

    while (segStart < segment.length) {
      if (segment[segStart] === remaining[0]) {
        let matchLen = 0;
        while (
          matchLen < segment.length - segStart &&
          matchLen < remaining.length &&
          segment[segStart + matchLen] === remaining[matchLen]
        ) {
          matchLen++;
        }

        if (matchLen > 0) {
          filterPos += matchLen;
          break;
        }
      }
      segStart++;
    }
  }

  return filterPos === lowerFilter.length;
}

// ── Generator ────────────────────────────────────────────────────────────────

/**
 * Walk directories breadth-first, yielding paths that pass the filter.
 * Yields root directories first, then their children.
 * Skips hidden and ignored directories.
 */
export function* walkDirs(
  roots: string[],
  maxDepth: number,
  filter: string,
  snapshot?: GeneratorSnapshot,
): Generator<string, GeneratorSnapshot, undefined> {
  // Initialize queue from snapshot or roots
  const queue: Array<{ path: string; depth: number }> = snapshot?.pending ??
    roots.map(r => ({ path: r, depth: 0 }));

  // Track if we've yielded roots yet (for fresh searches)
  let yieldedRoots = snapshot !== undefined;

  // Yield roots first (if not resuming from snapshot)
  if (!yieldedRoots) {
    for (const root of roots) {
      if (existsSync(root) && matchesFilter(root, filter)) {
        yield root;
      }
    }
    yieldedRoots = true;
  }

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;

    if (depth > maxDepth) continue;

    try {
      const entries = readdirSync(path, { withFileTypes: true });

      // Sort entries for consistent ordering
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = join(path, entry.name);

        // Add children to queue for next depth level
        if (depth < maxDepth) {
          queue.push({ path: fullPath, depth: depth + 1 });
        }

        // Yield if matches filter
        if (matchesFilter(fullPath, filter)) {
          yield fullPath;
        }
      }
    } catch {
      // Permission denied or other error - skip
    }
  }

  // Return final state for potential resumption
  return { pending: queue };
}

// ── Cache Management ─────────────────────────────────────────────────────────

/**
 * Initialize search state.
 */
export function initDirSearch(options: DirSearchOptions): DirSearchState {
  return {
    cache: new Map(),
    options,
  };
}

/**
 * Find longest prefix in cache that matches the filter.
 */
export function findLongestPrefixCache(
  cache: Map<string, CacheEntry>,
  filter: string,
): { prefix: string; entry: CacheEntry } | null {
  let bestPrefix = "";
  let bestEntry: CacheEntry | null = null;

  for (const [prefix, entry] of cache) {
    if (filter.startsWith(prefix) && prefix.length > bestPrefix.length) {
      bestPrefix = prefix;
      bestEntry = entry;
    }
  }

  return bestEntry ? { prefix: bestPrefix, entry: bestEntry } : null;
}

/**
 * Get directories matching filter, using cache when possible.
 */
export function getDirsForFilter(
  state: DirSearchState,
  filter: string,
): { dirs: string[]; state: DirSearchState } {
  const { cache, options } = state;
  const { roots, maxDepth, limit } = options;

  // Check for exact cache hit
  const exactHit = cache.get(filter);
  if (exactHit) {
    return { dirs: exactHit.dirs.slice(0, limit), state };
  }

  // Find longest prefix cache
  const prefixHit = findLongestPrefixCache(cache, filter);

  if (prefixHit) {
    // Filter cached results with new filter
    const filtered = prefixHit.entry.dirs.filter(d => matchesFilter(d, filter));

    if (filtered.length >= limit || prefixHit.entry.complete) {
      // Have enough results or search was complete
      const newEntry: CacheEntry = {
        dirs: filtered,
        complete: prefixHit.entry.complete,
      };
      const newCache = new Map(cache);
      newCache.set(filter, newEntry);

      return {
        dirs: filtered.slice(0, limit),
        state: { ...state, cache: newCache },
      };
    }

    // Need more results - continue from where prefix search left off
    // For now, just do a fresh search (optimization: resume generator)
  }

  // No useful cache - do fresh search
  const dirs: string[] = [];
  const gen = walkDirs(roots, maxDepth, filter);

  for (const dir of gen) {
    dirs.push(dir);
    if (dirs.length >= limit) break;
  }

  // Cache the results
  const newCache = new Map(cache);
  newCache.set(filter, {
    dirs,
    complete: dirs.length < limit,
  });

  // Limit cache size (simple LRU: remove oldest entries)
  const MAX_CACHE_SIZE = 10;
  if (newCache.size > MAX_CACHE_SIZE) {
    const firstKey = newCache.keys().next().value;
    if (firstKey !== undefined) {
      newCache.delete(firstKey);
    }
  }

  return {
    dirs,
    state: { ...state, cache: newCache },
  };
}
