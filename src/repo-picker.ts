/**
 * Repo picker - typeahead showing repos first, then directories.
 * Uses progressive directory search with caching.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  type DirSearchState,
  getDirsForFilter,
  initDirSearch,
  matchesFilter,
} from "./dir-search";
import { getKnownRepos, getRemoteUrl, type RepoInfo } from "./repo-store";
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
  dirSearch: DirSearchState;
  lastFilter: string;
}

export type RepoPickerResult =
  | { action: "continue"; state: RepoPickerState }
  | { action: "cancel" }
  | { action: "select"; repo: RepoInfo }
  | { action: "directory"; path: string };

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
 * Convert repos to typeahead items.
 */
function reposToItems(repos: RepoInfo[]): TypeaheadItem[] {
  return repos.map((repo) => ({
    id: `repo:${repo.remoteUrl}`,
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
 * Build combined items list from repos and directories.
 */
function buildItems(
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

  const repoItems = reposToItems(filteredRepos);
  const dirItems = dirsToItems(dirs);

  return [...repoItems, ...dirItems];
}

// ── State Management ─────────────────────────────────────────────────────────

/**
 * Initialize repo picker state.
 */
export function initRepoPicker(): RepoPickerState {
  const repos = getKnownRepos();
  const home = process.env.HOME || "/home";

  // Initialize directory search
  const dirSearch = initDirSearch({
    roots: [home, "/var", "/etc"],
    maxDepth: DIR_SEARCH_MAX_DEPTH,
    limit: DIR_SEARCH_LIMIT,
  });

  // Get initial directories (no filter)
  const { dirs, state: newDirSearch } = getDirsForFilter(dirSearch, "");

  // Build initial items
  const items = buildItems(repos, dirs, "");

  const typeahead = initTypeahead(items);
  return {
    typeahead: withDynamicTitle(typeahead),
    repos,
    dirSearch: newDirSearch,
    lastFilter: "",
  };
}

/**
 * Update items based on current filter.
 */
function updateItemsForFilter(
  state: RepoPickerState,
  filter: string,
): RepoPickerState {
  if (filter === state.lastFilter) {
    return state;
  }

  // Search for directories matching the new filter
  const { dirs, state: newDirSearch } = getDirsForFilter(
    state.dirSearch,
    filter,
  );

  // Build new items
  const items = buildItems(state.repos, dirs, filter);

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
    dirSearch: newDirSearch,
    lastFilter: filter,
  };
}

/**
 * Get dynamic title based on selected item.
 */
function getTitleForSelection(typeahead: TypeaheadState): string {
  const selected = typeahead.filtered[typeahead.selectedIndex];
  if (!selected) return "select";
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
      if (newFilter !== state.lastFilter) {
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

      // Check if it's a repo or directory based on id prefix
      if (itemId.startsWith("repo:")) {
        const remoteUrl = itemId.slice(5); // Remove "repo:" prefix
        const repo = state.repos.find((r) => r.remoteUrl === remoteUrl);
        if (repo) {
          return { action: "select", repo };
        }
        return { action: "cancel" };
      }

      if (itemId.startsWith("dir:")) {
        const path = itemId.slice(4); // Remove "dir:" prefix
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

      // Check if it's a valid directory
      if (existsSync(path)) {
        // Check if it's a git repo
        const remoteUrl = getRemoteUrl(path);
        if (remoteUrl) {
          // It's a repo - return it directly
          const repo: RepoInfo = {
            name: path.split("/").pop() || "repo",
            path,
            remoteUrl,
            lastSeen: Date.now(),
          };
          return { action: "select", repo };
        }
      }

      // Not a known repo, not a valid git repo - pass to directory handler
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
