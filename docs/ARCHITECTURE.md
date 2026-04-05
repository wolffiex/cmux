# cmux Architecture

Developer-oriented map of the codebase. For user-facing behavior, see `USER_GUIDE.md`.

## Overview

cmux is a single-binary TypeScript/Bun TUI. It talks to tmux via synchronous `execFileSync` calls, persists user state in SQLite, and renders to stdout with hand-rolled ANSI. The entry point is `src/main.ts`; the production build is `dist/cmux.js`.

Design decisions worth internalizing before you touch the code:

- **Startup speed is load-bearing.** A popup-launched tool has to feel instant. The wrapper uses process substitution to prefetch tmux data in parallel with Bun's module load. Startup is ~16 ms from keypress to first render, measured off the bundled `dist/cmux.js`.
- **Full-redraw rendering.** Every input triggers `ansi.clear` plus a single `process.stdout.write`. There is no diffing layer. Animations are the exception: they write only the rectangle that changes.
- **Single-writer SQLite, no WAL.** The DB lives at `$XDG_CACHE_HOME/cmux/cmux.sqlite` and is opened fresh per process. Because cmux is a short-lived popup, there are no concurrent writers to worry about.
- **Tmux is the source of truth for window state.** cmux never caches window or pane geometry across invocations. It always re-queries.

## Module map

### Entry and UI

- `src/main.ts` — TUI entry point: `State` shape, focus state machine, render loop, input parsing, animation scheduling, `applyAndExit()` layout pipeline, the `--install` flag handler, and `outputTmuxCommand()` for the shell wrapper eval.
- `src/box-chars.ts` — box-drawing glyph constants.
- `src/utils.ts` — `stripAnsi`, `easeOut`, `truncateName`, `splitWindowName`, `wordWrap`, `sanitizeWindowName`.
- `src/logger.ts` — lazy file logger gated on `CMUX_DEBUG`.

### Tmux integration

- `src/tmux.ts` — synchronous tmux query helpers using `execFileSync`. Exports `getWindowInfo`, `getWindows`, `STARTUP_COMMAND` (a chained tmux command that returns both window and pane data in one spawn), `parseStartupInfo`.
- `src/tmux-layout.ts` — builds tmux layout strings with the 16-bit rotating checksum. See "Layout strings" below.

### Layout

- `src/layouts.ts` — 10 layout templates plus `resolveLayout(template, w, h)`. See "Layout DSL" below.
- `src/layout-preview.ts` — renders an ASCII preview grid.
- `src/pane-matcher.ts` — greedy position matcher. See "Pane preservation" below.
- `src/swap-orchestrator.ts` — selection-sort swap sequence + `tmux swap-pane` executor.
- `src/layout-store.ts` — records layout transitions for future ranking (data collected but not yet used in the UI).

### Pickers / typeahead

- `src/typeahead.ts` — generic typeahead: fuzzy-path filtering (`matchesFuzzyPath`), key handling, rendering.
- `src/repo-picker.ts` — composes screens + repos + directories + commands into the top-level picker.
- `src/branch-picker.ts` — worktree + branch picker for a specific repo. Handles create/delete.
- `src/resumable-filter.ts` — resumable BFS directory scan. See "Resumable filter" below.
- `src/picker-store.ts` — `picker_frequency` SQLite table and `recordSelection` / `getAllFrequencies`.

### Git / store

- `src/db.ts` — `getDb()` singleton. Schema bootstrap lives in each store module.
- `src/cache.ts` — generic `Cache<T>` class backed by its own WAL-mode SQLite file. Only consumer is `window-summary.ts`.
- `src/repo-store.ts` — tracks known git repos with throttled writes (one per hour) and a 5-minute activity cache.
- `src/git-utils.ts` — `isGitRepo`, `resolveRepoPath` (handles worktrees via `git rev-parse --git-common-dir`), `getBranch`, `getLastActivity`.
- `src/worktree-utils.ts` — `deleteWorktree` with force fallback.
- `src/window-naming.ts` — startup rename: `generateWindowName(panePath, config)` + `renameAllWindows()`. Reads aliases from `~/.config/cmux/repos`.

### Dead code (slated for removal)

- `src/window-summary.ts` — Anthropic-based AI summaries. Not imported by `main.ts`.
- `src/summaries.ts` — older heuristic name generator, superseded by `window-naming.ts`.
- `src/fonts.ts` — big-font rendering, no callers.
- `src/dir-picker.ts` — older sibling-directory picker. Not used by `main.ts`, though it still has tests.
- The `@anthropic-ai/sdk` dependency can go once `window-summary.ts` is deleted.

## Focus state machine

`type Focus = "typeahead" | "carousel" | "layout"`. Initial state is `carousel` (see `main.ts:169`) — users land on their current window ready to act. Transitions live in `handleKey`, `handleCarouselFocus`, `handleLayoutFocus`, and `handleTypeaheadFocus` in `main.ts`.

```
           ┌──────────┐  Tab / up-at-top   ┌──────────┐
           │typeahead │◄────────────────── │ carousel │ ← initial
           │          │ ──────────────────►│          │
           └──────────┘  Tab / j-down      └──────────┘
                                                │
                                                │ Enter on current window
                                                ▼
                                           ┌──────────┐
                                           │  layout  │
                                           └──────────┘
                                                │
                                                │ Escape
                                                ▼
                                           back to carousel
```

`q` quits unless focus is `typeahead`, where `q` is just a printable character. The typeahead focus has a sub-mode, `typeaheadMode: "picker" | "branchPicker"`, which tracks whether the user has drilled into a repo.

## Render loop

`render()` is a single function that builds a multi-line string and writes it to stdout in one call after `ansi.clear`. The layout is:

```
rows 0..5      carousel (outer box + inner window boxes)
row 6          separator
row 7          (blank)
rows 8..h-3    middle panel: layout preview (left) OR typeahead picker
row h-2        separator
row h-1        hint bar
```

There is no virtual DOM and no diff pass. The hot path is:

1. `initState()` parses pre-fetched tmux data, or spawns `getStartupInfo()` if there is no prefetch.
2. `render()` produces a full-screen string.
3. `process.stdin.on("data", ...)` parses input byte by byte. The ESC / CSI / Alt parser is hand-rolled at `main.ts:1748`.
4. `handleKey(key)` dispatches to the focus-specific handler, mutates `state`, and calls `render()` again.

Animations bypass the full redraw. `startAnimation` (layout slide, 12 frames × 16 ms) and `startWindowSwapAnimation` (8 frames × 25 ms) use `setTimeout` to tick, and each frame writes only the rectangle that changes.

## SQLite schema

Single shared DB at `$XDG_CACHE_HOME/cmux/cmux.sqlite`, chmod 0600. No WAL — single-writer assumption. Additional per-cache DBs are opened by `src/cache.ts`.

```sql
-- picker-store.ts: tracks how often each picker item is selected
picker_frequency (
  host TEXT NOT NULL DEFAULT 'local',
  type TEXT NOT NULL,          -- 'screen' | 'repo' | 'dir' | 'cmd' | 'host'
  key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (host, type, key)
);

-- repo-store.ts: known git repos + cached activity timestamp
repos (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  last_activity INTEGER,          -- cached git log HEAD %ct, 5-min TTL
  last_activity_checked INTEGER
);

-- layout-store.ts: layout transition counts (collected but not yet used)
transitions (
  from_layout TEXT NOT NULL,
  to_layout TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (from_layout, to_layout)
);
```

**Migration pattern.** `repo-store.ts` uses a lenient `PRAGMA table_info()` check followed by a conditional `ALTER TABLE ADD COLUMN`. There is no migration version table. Keep migrations additive: if you need a schema change that cannot be expressed as a new column, drop and recreate the table inside `ensureTable()`.

### The aspirational schema in `docs/cmux2.md`

The v2 design doc proposes `hosts`, `branches`, `directories`, and a `(host, path)`-keyed `repos` table for a remote-nested-tmux feature. **None of that is implemented.** When you read cmux2.md, treat the data-model section as a proposal, not as current state.

## Tmux integration

All fast queries are synchronous `execFileSync("tmux", [...])` with format strings. The convention is colon-delimited fields:

```ts
// tmux.ts:37
tmux list-panes -t :N -F '#{window_width}:#{window_height}:#{pane_id}:#{pane_width}:#{pane_height}:#{pane_left}:#{pane_top}:#{pane_title}'
```

### Startup prefetch

`STARTUP_COMMAND` (`tmux.ts:153`) is a chained `tmux list-windows ... \; list-panes ...` string with a `SECTION_SEP` sentinel between the two sections. The wrapper script runs it inside `<(...)` process substitution. `main.ts:initState` detects the `/dev/fd/` argv path and reads the prefetched output synchronously, skipping the tmux spawn on the hot path. This is the single biggest startup optimisation in the codebase.

### Layout strings

tmux layout strings look like this:

```
checksum,WxH,x,y,pane_id              -- leaf
checksum,WxH,x,y{child,child,...}     -- horizontal split (columns)
checksum,WxH,x,y[child,child,...]     -- vertical split (rows)
```

`tmux-layout.ts:33` computes the 16-bit rotating checksum that prefixes the string:

```ts
// per char:
csum = (csum >> 1) + ((csum & 1) << 15);
csum += charCode;
csum &= 0xffff;
// final 4-char lowercase hex
```

`buildLayoutTree()` (line 46) is recursive: at each node, compute unique x positions from the pane list; if there are multiple, emit a horizontal split ({…}); else vertical ([…]); else a leaf. Panes are bucketed into columns by "highest x ≤ pane.x".

**Critical tmux gotcha.** tmux ignores pane IDs inside the layout string and assigns panes to slots in creation order. This is why cmux has to physically swap panes into the right order with `tmux swap-pane` before calling `tmux select-layout`: the layout string alone cannot place them.

## Pane preservation during layout change

This is the most intricate pipeline in cmux. It lives in `main.ts:applyAndExit` and spans four supporting modules.

### Scoring (`pane-matcher.ts`)

`calculateMatchScore(pane, slot, maxY)`:

- If the pane and slot rectangles overlap, score is `overlap_area × topBiasMultiplier`.
- If no overlap, score is `-centerDistance - 1 + (topBiasMultiplier - 1) × 100`.

`topBiasMultiplier = 1.0 + 0.2 × (1 - slot.y / maxY)`, ranging over [1.0, 1.2]. This makes slots at the top of the window slightly more attractive, so that when a tall pane splits into a stack the top slot wins and new panes are created at the bottom, where the user expects them.

`matchPanesToSlots(panes, slots)` builds the full pane×slot score matrix, sorts descending, and greedy-picks pairs whose pane and slot are both still unmatched. Returns `{matches, unmatchedSlots, unmatchedPanes}`.

### Swap sequence (`swap-orchestrator.ts`)

`computeSwaps(currentOrder, desiredOrder)` is a plain selection sort. At each position `i`, find where `desiredOrder[i]` currently sits in the working copy and swap if different. At most `N-1` swaps are produced. Validation throws if the two arrays do not have identical id sets.

`executeSwaps(windowTarget, swaps)` runs each swap as `tmux swap-pane -s <target>.<from> -t <target>.<to>`.

### The pipeline

```
1. matchPanesToSlots(existingPanes, targetSlots)
2. for each unmatchedSlot: tmux split-window -c <current-path>  (new panes land at end)
3. refetch panes
4. desiredOrder = matched panes at their matched slot indices,
                  new panes filling unmatched slots in order
5. computeSwaps(currentOrder, desiredOrder) → tmux swap-pane sequence
6. executeSwaps(...)
7. for each unmatchedPane: tmux kill-pane -t <id>   (excess panes go last)
8. generateLayoutString(finalPanes, w, h) → tmux select-layout <string>
```

Pane IDs and scrollback are preserved for matched panes because `tmux swap-pane` does not destroy them.

## Layout DSL (`layouts.ts`)

Templates use normalized `x, y, width, height ∈ [0, 1]` with two encoded escape hatches:

- **Negative `height`** (e.g. `-MIN_ROWS = -6`): absolute rows. `windowHeight - |h| - 1` reserves a separator row.
- **Negative `y`**: positions from the bottom. `y = windowHeight - |y|`.
- **Fractional `height ∈ [-1, 0)`**: fraction of usable height, but negative so it reads as "small".

`resolveLayout(template, windowWidth, windowHeight)` is a two-pass layout resolver:

1. Compute unique x positions → number of columns. `usableWidth = windowWidth - (numCols - 1)` (reserves one column separator between each pair).
2. For each pane, compute x by column index, width by fraction, y per-column (each column has its own usableHeight), height by the encoding above.

Panes whose right edge hits `1.0` or whose bottom edge hits `1.0` get "take the remainder" treatment so rounding never leaves gaps.

`ALL_LAYOUTS` is `[...layouts1, ...layouts2, ...layouts3, ...layouts4]` — 1 + 1 + 4 + 4 = 10. Order matters: `findBestMatchingLayout` iterates in this order and picks the highest-scoring layout with a matching pane count.

## Typeahead and resumable filter

`typeahead.ts` is a generic component: an input buffer, a list of `TypeaheadItem`s, a filter function, and a selected index. Keystrokes are handled in `handleTypeaheadKey`.

**Fuzzy-path matching** (`matchesFuzzyPath`) splits the label on `/` and walks the input across segments, consuming maximal runs of characters in order. Input is accepted if all characters are consumed by the end of some segment. Plain substring matching is the fallback.

### Resumable filter (`resumable-filter.ts`)

The directory search under `~`, `/var`, and `/etc` is a breadth-first scan with aggressive pruning. It is "resumable" in the sense that as the user adds characters to the needle, the filter narrows without rescanning from scratch.

Structure:

```ts
{
  needle: string,
  results: string[],           // all matches so far
  pending: {path, depth}[],    // BFS queue
  pendingIndex: number,        // read cursor (avoids Array.shift)
  currentRootIndex: number,
  complete: boolean,
  options: {roots, maxDepth, limit}
}
```

`updateFilter(filter, newNeedle)`:

- If `newNeedle.startsWith(oldNeedle)`, **narrow mode**: filter the existing `results` with the new needle. If enough matches remain or the scan is already complete, we're done. Otherwise, resume the BFS from `pendingIndex`.
- Otherwise, **reset** and scan from scratch.

Optimizations:

- Index-based read cursor instead of `Array.shift` (O(1) vs O(n)).
- Copy-on-write tail: only copies the unread portion when a push is first needed.
- Periodic compaction (`pendingIndex > 1000` and past the midpoint).
- `IGNORED_DIRS` set (node_modules, .git, vendor, dist, build, target, venv, ...).
- Matching children are **not queued for further descent**. When the scan finds `~/code/cmux`, it does not descend into `cmux/` looking for more matches. `pruneDescendants` additionally filters out any result whose ancestor is also a result, except for the configured roots themselves.

Settings: `maxDepth = 4`, `limit = 20` (see `repo-picker.ts:50-51`).

## Build and install

```jsonc
// package.json
"scripts": {
  "start": "bun src/main.ts",
  "build": "bun build src/main.ts --target=bun --outfile dist/cmux.js",
  "install": "bun run build && bun dist/cmux.js --install",
  "test": "bun test",
  "typecheck": "bunx tsc --noEmit",
  "lint": "biome check src test && oxlint src test"
}
```

`bun run install` builds the bundle and runs it with `--install`, which writes `~/.local/bin/cmux` containing `eval "$(bun /path/to/dist/cmux.js <(<prefetch>))"`. Always run `bun run build` after code changes before testing interactively — the installed cmux runs the bundle, not the source files.

## Environment variables cmux actually reads

| Variable | Reader | Effect |
|---|---|---|
| `TMUX` | `main.ts:1624` | detects in-tmux vs outside-tmux |
| `HOME` | install, various | required for `--install`; home path fallback |
| `XDG_CACHE_HOME` | `db.ts:20`, `cache.ts:7` | DB + cache location |
| `XDG_CONFIG_HOME` | `window-naming.ts:19` | repo alias config location |
| `CMUX_DEBUG` | `logger.ts:4` | enables `/tmp/cmux.log` |
| `CMUX_BENCHMARK` | `main.ts:96` | exits after first render |
| `ZDOTDIR` | `main.ts:1284` | saved as `CMUX_REAL_ZDOTDIR` for the quick-shell |
| `ANTHROPIC_API_KEY` | `window-summary.ts:19` | only the dead AI path — no live effect |

## Conventions for new contributors

- **No rendering libraries.** Add ANSI strings to the `ansi` object in `main.ts` or use box-chars. Do not pull in chalk, blessed, ink, etc.
- **Tmux commands go through `execFileSync`** (not shell), with explicit arg arrays to avoid escaping bugs.
- **Hot-path queries go in `STARTUP_COMMAND`.** If you find yourself adding a second `execFileSync` during startup, fold it into the chained command instead.
- **Stores bootstrap their own schema.** `repo-store.ts` and `picker-store.ts` call `ensureTable()` lazily on first use. Don't centralize schema in `db.ts`.
- **Focus handlers stay pure.** Each `handleXFocus` returns before calling `render()` so you can unit-test state transitions without drawing.
- **Verify UI changes with VHS**, not only with `bun test`. See `TESTING.md`.

## Where to look first

| Question | File |
|---|---|
| Why does cmux start so fast? | `main.ts:outputTmuxCommand`, `tmux.ts:STARTUP_COMMAND`, `main.ts:initState` |
| How does Enter on a window open the layout picker? | `main.ts:handleCarouselFocus` |
| How are panes preserved across layout changes? | `main.ts:applyAndExit` → `pane-matcher.ts` → `swap-orchestrator.ts` → `tmux-layout.ts` |
| How does the typeahead dedupe repos vs screens? | `repo-picker.ts:buildItems` |
| How are window names computed on startup? | `window-naming.ts:generateWindowName`, called from `main.ts:renameWindowsOnStartup` |
| Where's the DB? | `~/.cache/cmux/cmux.sqlite`; schemas in `picker-store.ts`, `repo-store.ts`, `layout-store.ts` |
