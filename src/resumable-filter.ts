/**
 * Resumable directory filter.
 *
 * Maintains a single search that can be narrowed (by extending the filter string)
 * or restarted (if the new filter doesn't match the prefix).
 *
 * Key insight: when narrowing from "co" to "code", we can filter existing results
 * AND resume scanning from where we left off if we need more.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Directories to skip
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
  "target",
  "venv",
  ".venv",
  "env",
  ".tox",
]);

// ── Types ────────────────────────────────────────────────────────────────────

export interface FilterOptions {
  roots: string[];
  maxDepth: number;
  limit: number;
}

export interface ResumableFilter {
  needle: string;
  results: string[]; // All results found so far (may exceed limit)
  pending: Array<{ path: string; depth: number }>; // BFS queue for resumption
  currentRootIndex: number; // Which root we're currently processing
  complete: boolean; // True if we've exhausted all directories
  options: FilterOptions;
}

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

// ── Filter Operations ────────────────────────────────────────────────────────

/**
 * Create a new resumable filter and run initial search.
 */
export function createFilter(
  options: FilterOptions,
  needle: string,
): ResumableFilter {
  const filter: ResumableFilter = {
    needle,
    results: [],
    pending: [],
    currentRootIndex: 0,
    complete: false,
    options,
  };

  // Run initial search up to limit
  return scanUntilLimit(filter);
}

/**
 * Update filter with new needle.
 * If newNeedle extends current needle, filter existing results and resume if needed.
 * Otherwise, create fresh filter.
 */
export function updateFilter(
  filter: ResumableFilter,
  newNeedle: string,
): ResumableFilter {
  // If new needle extends current, we can narrow existing results
  if (newNeedle.startsWith(filter.needle)) {
    // Filter existing results with new needle
    const narrowed = filter.results.filter((d) => matchesFilter(d, newNeedle));

    const newFilter: ResumableFilter = {
      ...filter,
      needle: newNeedle,
      results: narrowed,
    };

    // If we have enough results or search was complete, we're done
    if (narrowed.length >= filter.options.limit || filter.complete) {
      return newFilter;
    }

    // Need more results - resume scanning with new needle
    return scanUntilLimit(newFilter);
  }

  // New needle doesn't extend current - start fresh
  return createFilter(filter.options, newNeedle);
}

/**
 * Get results from filter (up to limit).
 */
export function getResults(filter: ResumableFilter): string[] {
  return filter.results.slice(0, filter.options.limit);
}

// ── Internal Scanning ────────────────────────────────────────────────────────

/**
 * Continue scanning directories until we have enough results or exhaust search.
 */
function scanUntilLimit(filter: ResumableFilter): ResumableFilter {
  const { roots, maxDepth, limit } = filter.options;
  const results = [...filter.results];
  const pending = [...filter.pending];
  let rootIndex = filter.currentRootIndex;

  // Process roots starting from where we left off
  while (rootIndex < roots.length) {
    const root = roots[rootIndex];

    // If pending is empty and this is a new root, initialize it
    if (pending.length === 0) {
      // Yield root itself first
      if (existsSync(root) && matchesFilter(root, filter.needle)) {
        results.push(root);
        if (results.length >= limit) {
          return {
            ...filter,
            results,
            pending,
            currentRootIndex: rootIndex,
            complete: false,
          };
        }
      }
      pending.push({ path: root, depth: 0 });
    }

    // BFS within current root
    while (pending.length > 0) {
      const item = pending.shift();
      if (!item) break;

      const { path, depth } = item;
      if (depth > maxDepth) continue;

      try {
        const entries = readdirSync(path, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith(".")) continue;
          if (IGNORED_DIRS.has(entry.name)) continue;

          const fullPath = join(path, entry.name);
          if (depth < maxDepth) {
            pending.push({ path: fullPath, depth: depth + 1 });
          }
          if (matchesFilter(fullPath, filter.needle)) {
            results.push(fullPath);
            if (results.length >= limit) {
              return {
                ...filter,
                results,
                pending,
                currentRootIndex: rootIndex,
                complete: false,
              };
            }
          }
        }
      } catch {
        // Permission denied - skip
      }
    }

    // Move to next root
    rootIndex++;
  }

  // Exhausted all directories
  return {
    ...filter,
    results,
    pending: [],
    currentRootIndex: rootIndex,
    complete: true,
  };
}
