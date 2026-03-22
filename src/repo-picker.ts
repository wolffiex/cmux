/**
 * Picker - typeahead showing screens, repos, and directories.
 * Uses resumable filter for progressive directory search.
 * Items are ordered by selection frequency (most used first).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  getAllFrequencies,
  recordSelection,
  type PickerFrequency,
} from "./picker-store";
import { getKnownRepos, isGitRepo, type RepoInfo } from "./repo-store";
import {
  createFilter,
  getResults,
  matchesFilter,
  type ResumableFilter,
  updateFilter,
} from "./resumable-filter";
import type { TmuxWindow } from "./tmux";
import {
  handleTypeaheadKey,
  initTypeahead,
  renderTypeahead,
  type TypeaheadItem,
  type TypeaheadState,
} from "./typeahead";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RepoPickerState {
  typeahead: TypeaheadState;
  repos: RepoInfo[];
  windows: TmuxWindow[];
  dirFilter: ResumableFilter;
}

export type RepoPickerResult =
  | { action: "continue"; state: RepoPickerState }
  | { action: "cancel" }
  | { action: "select"; repo: RepoInfo }
  | { action: "directory"; path: string }
  | { action: "screen"; window: TmuxWindow };

// ── Constants ────────────────────────────────────────────────────────────────

const DIR_SEARCH_LIMIT = 20;
const DIR_SEARCH_MAX_DEPTH = 4;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a path with ~ substitution for home directory.
 */
function formatPath(path: string): string {
  const home = process.env.HOME || "/home";
  if (path.startsWith(`${home}/`)) {
    return `~${path.slice(home.length)}`;
  }
  if (path === home) {
    return "~";
  }
  return path;
}

/**
 * Convert screens (tmux windows) to typeahead items.
 */
function screensToItems(windows: TmuxWindow[]): TypeaheadItem[] {
  return windows.map((win) => ({
    id: `screen:${win.index}`,
    label: win.name,
    hint: win.active ? "●" : undefined,
    icon: "📺",
  }));
}

/**
 * Convert repos to typeahead items.
 */
function reposToItems(repos: RepoInfo[]): TypeaheadItem[] {
  return repos.map((repo) => ({
    id: `repo:${repo.path}`,
    label: repo.name,
    hint: repo.path.replace(/^\/home\/[^/]+\//, "~/"),
    icon: "📦",
  }));
}

/**
 * Convert directories to typeahead items.
 */
function dirsToItems(dirs: string[]): TypeaheadItem[] {
  return dirs.map((path) => ({
    id: `dir:${path}`,
    label: formatPath(path),
    icon: "📁",
  }));
}

/**
 * Sort items by picker frequency. Items with higher frequency come first.
 * Items not in the frequency table keep their original order but come after
 * items that have frequency data.
 */
// Map picker store types to item id prefixes
const TYPE_TO_PREFIX: Record<string, string> = {
  screen: "screen:",
  repo: "repo:",
  directory: "dir:",
  host: "host:",
};

function sortByFrequency(
  items: TypeaheadItem[],
  frequencies: PickerFrequency[],
): TypeaheadItem[] {
  // Build a lookup: item_id -> count
  const freqMap = new Map<string, number>();
  for (const f of frequencies) {
    const prefix = TYPE_TO_PREFIX[f.type] ?? `${f.type}:`;
    freqMap.set(`${prefix}${f.key}`, f.count);
  }

  return [...items].sort((a, b) => {
    const freqA = freqMap.get(a.id) ?? 0;
    const freqB = freqMap.get(b.id) ?? 0;
    return freqB - freqA; // Higher frequency first
  });
}

/**
 * Build combined items list from screens, repos, and directories.
 * Order: screens (except current), repos, directories.
 * Repos and dirs sorted by frequency within their groups.
 */
function buildItems(
  windows: TmuxWindow[],
  repos: RepoInfo[],
  dirs: string[],
  filter: string,
): TypeaheadItem[] {
  // Filter repos by the search filter
  const filteredRepos = filter
    ? repos.filter(
        (r) => matchesFilter(r.name, filter) || matchesFilter(r.path, filter),
      )
    : repos;

  // Exclude current screen — you're already there
  const otherWindows = windows.filter((w) => !w.active);
  const screenItems = screensToItems(otherWindows);
  const repoItems = reposToItems(filteredRepos);
  const dirItems = dirsToItems(dirs);

  // Sort each group by frequency independently
  const frequencies = getAllFrequencies();
  const sortedScreens = sortByFrequency(screenItems, frequencies);
  const sortedRepos = sortByFrequency(repoItems, frequencies);
  const sortedDirs = sortByFrequency(dirItems, frequencies);

  // Screens first, then repos, then directories
  return [...sortedScreens, ...sortedRepos, ...sortedDirs];
}

// ── State Management ─────────────────────────────────────────────────────────

/**
 * Initialize repo picker state.
 */
export function initRepoPicker(windows: TmuxWindow[] = []): RepoPickerState {
  const repos = getKnownRepos();
  const home = process.env.HOME || "/home";

  // Initialize directory filter
  const dirFilter = createFilter(
    {
      roots: [home, "/var", "/etc"],
      maxDepth: DIR_SEARCH_MAX_DEPTH,
      limit: DIR_SEARCH_LIMIT,
    },
    "",
  );

  // Build initial items
  const dirs = getResults(dirFilter);
  const items = buildItems(windows, repos, dirs, "");

  const typeahead = initTypeahead(items);
  return {
    typeahead: withDynamicTitle(typeahead),
    repos,
    windows,
    dirFilter,
  };
}

/**
 * Update items based on current filter.
 */
function updateItemsForFilter(
  state: RepoPickerState,
  filter: string,
): RepoPickerState {
  if (filter === state.dirFilter.needle) {
    return state;
  }

  // Update filter with new needle
  const newDirFilter = updateFilter(state.dirFilter, filter);
  const dirs = getResults(newDirFilter);

  // Build new items
  const items = buildItems(state.windows, state.repos, dirs, filter);

  // Update typeahead with new items (preserving input and selection where possible)
  const newTypeahead: TypeaheadState = {
    ...state.typeahead,
    items,
    filtered: items, // Will be re-filtered by typeahead
    selectedIndex: 0,
  };

  return {
    ...state,
    typeahead: newTypeahead,
    dirFilter: newDirFilter,
  };
}

/**
 * Get dynamic title based on selected item.
 */
function getTitleForSelection(typeahead: TypeaheadState): string {
  const selected = typeahead.filtered[typeahead.selectedIndex];
  if (!selected) return "select";
  if (selected.id.startsWith("screen:")) return "screen";
  if (selected.id.startsWith("repo:")) return "repo";
  if (selected.id.startsWith("dir:")) return "directory";
  return "select";
}

/**
 * Update typeahead with dynamic title based on selection.
 */
function withDynamicTitle(typeahead: TypeaheadState): TypeaheadState {
  return { ...typeahead, title: getTitleForSelection(typeahead) };
}

/**
 * Handle key press.
 */
export function handleRepoPickerKey(
  state: RepoPickerState,
  key: string,
): RepoPickerResult {
  const result = handleTypeaheadKey(state.typeahead, key);

  switch (result.action) {
    case "continue": {
      let newState = { ...state, typeahead: result.state };

      // If input changed, update items with new filter
      const newFilter = result.state.input;
      if (newFilter !== state.dirFilter.needle) {
        newState = updateItemsForFilter(newState, newFilter);
        // Re-apply the typeahead state with updated items
        newState.typeahead = {
          ...newState.typeahead,
          input: newFilter,
          filtered: newState.typeahead.items.filter((item) =>
            matchesFilter(item.label, newFilter),
          ),
          selectedIndex: 0,
        };
      }

      // Update title based on current selection
      newState.typeahead = withDynamicTitle(newState.typeahead);

      return { action: "continue", state: newState };
    }

    case "cancel":
      return { action: "cancel" };

    case "select": {
      const itemId = result.item.id;

      if (itemId.startsWith("screen:")) {
        const windowIndex = parseInt(itemId.slice(7), 10);
        const win = state.windows.find((w) => w.index === windowIndex);
        if (win) {
          recordSelection("screen", win.name);
          return { action: "screen", window: win };
        }
        return { action: "cancel" };
      }

      if (itemId.startsWith("repo:")) {
        const repoPath = itemId.slice(5);
        const repo = state.repos.find((r) => r.path === repoPath);
        if (repo) {
          recordSelection("repo", repo.path);
          return { action: "select", repo };
        }
        return { action: "cancel" };
      }

      if (itemId.startsWith("dir:")) {
        const path = itemId.slice(4);
        recordSelection("directory", path);
        return { action: "directory", path };
      }

      return { action: "cancel" };
    }

    case "create": {
      // User typed something that doesn't match - treat as path
      const input = result.input.trim();

      // Expand ~ to home dir
      const expanded = input.startsWith("~")
        ? input.replace(/^~/, process.env.HOME || "")
        : input;

      // Resolve to absolute path
      const path = resolve(expanded);

      // Check if it's a valid git repo
      if (existsSync(path) && isGitRepo(path)) {
        const repo: RepoInfo = {
          name: path.split("/").pop() || "repo",
          path,
          lastSeen: Date.now(),
        };
        return { action: "select", repo };
      }

      // Not a git repo - pass to directory handler
      return { action: "directory", path };
    }
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * Render repo picker.
 */
export function renderRepoPicker(
  state: RepoPickerState,
  width: number,
  height: number,
): string {
  return renderTypeahead(state.typeahead, width, height);
}
