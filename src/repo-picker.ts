/**
 * Repo picker - typeahead for known repos, falls back to path on miss.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  initTypeahead,
  handleTypeaheadKey,
  renderTypeahead,
  type TypeaheadItem,
  type TypeaheadState,
} from "./typeahead";
import { getKnownRepos, getRemoteUrl, type RepoInfo } from "./repo-store";

// ── Types ───────────────────────────────────────────────────────────────────

export interface RepoPickerState {
  typeahead: TypeaheadState;
  repos: RepoInfo[];
}

export type RepoPickerResult =
  | { action: "continue"; state: RepoPickerState }
  | { action: "cancel" }
  | { action: "select"; repo: RepoInfo }
  | { action: "path"; path: string };  // fall back to path (for dir picker or validation)

// ── State Management ────────────────────────────────────────────────────────

/**
 * Convert repos to typeahead items.
 */
function reposToItems(repos: RepoInfo[]): TypeaheadItem[] {
  return repos.map((repo) => ({
    id: repo.remoteUrl,
    label: repo.name,
    hint: repo.path.replace(/^\/home\/[^/]+\//, "~/"),
  }));
}

/**
 * Initialize repo picker state.
 */
export function initRepoPicker(): RepoPickerState {
  const repos = getKnownRepos();
  const items = reposToItems(repos);

  return {
    typeahead: initTypeahead(items, "Choose repo"),
    repos,
  };
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
    case "continue":
      return {
        action: "continue",
        state: { ...state, typeahead: result.state },
      };

    case "cancel":
      return { action: "cancel" };

    case "select": {
      // Find the repo by remote URL
      const repo = state.repos.find((r) => r.remoteUrl === result.item.id);
      if (repo) {
        return { action: "select", repo };
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

      // Not a known repo, not a valid git repo - pass to path handler
      return { action: "path", path };
    }
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

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
