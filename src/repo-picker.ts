/**
 * Picker - typeahead showing screens, repos, and directories.
 * Uses resumable filter for progressive directory search.
 * Items are ordered by selection frequency (most used first).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  getAllFrequencies,
  type PickerFrequency,
  recordSelection,
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
  cwd: string;
}

export type RepoPickerResult =
  | { action: "continue"; state: RepoPickerState }
  | { action: "cancel" }
  | { action: "select"; repo: RepoInfo }
  | { action: "directory"; path: string }
  | { action: "screen"; window: TmuxWindow }
  | { action: "command"; command: string };

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

// ── Commands ────────────────────────────────────────────────────────────────

function buildShellCommand(cwd: string): TypeaheadItem {
  return {
    id: "shell",
    type: "cmd",
    label: "shell",
    hint: cwd ? formatPath(cwd) : "",
    icon: "⚡",
  };
}

/**
 * Convert screens (tmux windows) to typeahead items.
 */
function screensToItems(windows: TmuxWindow[]): TypeaheadItem[] {
  return windows.map((win) => ({
    id: String(win.index),
    type: "screen",
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
    id: repo.path,
    type: "repo",
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
    id: path,
    type: "dir",
    label: formatPath(path),
    icon: "📁",
  }));
}

/**
 * Sort items by picker frequency. Items with higher frequency come first.
 * Items not in the frequency table keep their original order but come after
 * items that have frequency data.
 */
function sortByFrequency(
  items: TypeaheadItem[],
  frequencies: PickerFrequency[],
): TypeaheadItem[] {
  // Build a lookup: "type:key" -> count
  const freqMap = new Map<string, number>();
  for (const f of frequencies) {
    freqMap.set(`${f.type}:${f.key}`, f.count);
  }

  return [...items].sort((a, b) => {
    const freqA = freqMap.get(`${a.type}:${a.id}`) ?? 0;
    const freqB = freqMap.get(`${b.type}:${b.id}`) ?? 0;
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
  cwd: string,
): TypeaheadItem[] {
  // Filter repos by the search filter
  const filteredRepos = filter
    ? repos.filter(
        (r) => matchesFilter(r.name, filter) || matchesFilter(r.path, filter),
      )
    : repos;

  // Exclude current screen and screens that match a known repo name
  // (the repo entry already covers them — selecting the repo drills into branches)
  const repoNames = new Set(filteredRepos.map((r) => r.name));
  const otherWindows = windows.filter((w) => {
    if (w.active) return false; // Already on this screen
    // Window name "foo" or "foo/branch" matches repo named "foo"
    const screenRepo = w.name.split("/")[0];
    if (repoNames.has(screenRepo)) return false;
    return true;
  });
  const screenItems = screensToItems(otherWindows);
  const repoItems = reposToItems(filteredRepos);

  // Exclude directories that are already shown as repos
  const repoPaths = new Set(filteredRepos.map((r) => r.path));
  const nonRepoDirs = dirs.filter((d) => !repoPaths.has(d));
  const dirItems = dirsToItems(nonRepoDirs);

  // Sort each group by frequency independently
  const frequencies = getAllFrequencies();
  const sortedScreens = sortByFrequency(screenItems, frequencies);
  const sortedRepos = sortByFrequency(repoItems, frequencies);
  const sortedDirs = sortByFrequency(dirItems, frequencies);

  // Commands, repos, screens, directories
  return [
    buildShellCommand(cwd),
    ...sortedRepos,
    ...sortedScreens,
    ...sortedDirs,
  ];
}

// ── State Management ─────────────────────────────────────────────────────────

/**
 * Initialize repo picker state.
 */
export function initRepoPicker(
  windows: TmuxWindow[] = [],
  cwd: string = "",
): RepoPickerState {
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
  const items = buildItems(windows, repos, dirs, "", cwd);

  const typeahead = initTypeahead(items);
  return {
    typeahead: withDynamicTitle(typeahead),
    repos,
    windows,
    dirFilter,
    cwd,
  };
}

/**
 * Update the cwd used for the shell command hint, rebuilding items in place.
 * Preserves current filter and selection where possible.
 */
export function setRepoPickerCwd(
  state: RepoPickerState,
  cwd: string,
): RepoPickerState {
  if (cwd === state.cwd) return state;
  const dirs = getResults(state.dirFilter);
  const items = buildItems(
    state.windows,
    state.repos,
    dirs,
    state.dirFilter.needle,
    cwd,
  );
  const newTypeahead: TypeaheadState = {
    ...state.typeahead,
    items,
    filtered: items,
  };
  return {
    ...state,
    typeahead: withDynamicTitle(newTypeahead),
    cwd,
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
  const items = buildItems(state.windows, state.repos, dirs, filter, state.cwd);

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
  switch (selected.type) {
    case "cmd":
      return "command";
    case "screen":
      return "screen";
    case "repo":
      return "repo";
    case "dir":
      return "directory";
    default:
      return "select";
  }
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
      const item = result.item;

      switch (item.type) {
        case "cmd":
          return { action: "command", command: item.id };

        case "screen": {
          const windowIndex = parseInt(item.id, 10);
          const win = state.windows.find((w) => w.index === windowIndex);
          if (win) {
            recordSelection("screen", win.name);
            return { action: "screen", window: win };
          }
          return { action: "cancel" };
        }

        case "repo": {
          const repo = state.repos.find((r) => r.path === item.id);
          if (repo) {
            recordSelection("repo", repo.path);
            return { action: "select", repo };
          }
          return { action: "cancel" };
        }

        case "dir":
          recordSelection("dir", item.id);
          return { action: "directory", path: item.id };

        default:
          return { action: "cancel" };
      }
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
