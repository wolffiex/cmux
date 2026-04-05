# cmux

tmux UI wrapper — typeahead-first workspace manager.

## Installation

```bash
# Build the bundle and install the wrapper script to ~/.local/bin/cmux
bun run install

# Make sure ~/.local/bin is in your PATH
export PATH="$HOME/.local/bin:$PATH"
```

`bun run install` builds `dist/cmux.js` first, then runs it with `--install` to write the wrapper. Do not run `bun src/main.ts --install` — the wrapper it installs would point back at the source file.

## How It Works

cmux uses a shell replacement trick for zero-overhead startup:

1. **Wrapper script** (`~/.local/bin/cmux`): `eval "$(bun src/main.ts)"`
2. **Outside tmux**: cmux outputs `exec tmux new-session ...` — the wrapper evals this, replacing the shell process with tmux directly. No intermediate process remains. The tmux session gets an Alt-Space binding for the popup.
3. **Inside tmux** (Alt-Space): `display-popup -w 80% -h 80% -E 'bun src/main.ts'` runs the UI directly in a popup. When cmux exits, the popup closes.

The `exec` pattern means environment variables (API keys, etc.) don't leak to child processes — the original shell is replaced entirely.

## Features

- **Typeahead picker** — unified fuzzy finder for repos, screens, directories, and commands. Opens on startup. Items sorted by selection frequency.
- **Window carousel** — horizontal strip showing all tmux windows with repo/branch names. Navigate with h/l, Tab to switch focus.
- **Layout picker** — cycle through 2-4 pane layouts with slide animation. Enter from carousel to apply.
- **Quick shell** — run a single command, output copied to clipboard automatically. Full zsh completion and aliases.
- **Worktree creation** — select a repo, type a branch name, get a new worktree branched from origin/main.
- **Frequency tracking** — picker items and layout transitions are ranked by how often you use them.
- **Smart deduplication** — repos that match open screens are shown once; directories that are repos appear only as repos.

## Environment Variables

- `CMUX_DEBUG=1` - Enables debug logging to `/tmp/cmux.log`
- `CMUX_BENCHMARK=1` - Headless mode for benchmarking (exits after init)

## Architecture

Single binary (`src/main.ts`) using raw ANSI for fast startup (~16ms).

### Files

- `src/main.ts` - Main UI, key handling, focus management, tmux integration
- `src/db.ts` - Shared SQLite database (single file, no WAL)
- `src/cache.ts` - Generic disk cache with its own WAL-mode SQLite file per instance
- `src/typeahead.ts` - Generic typeahead component with fuzzy filtering
- `src/resumable-filter.ts` - Resumable BFS directory scan used by the repo picker
- `src/repo-picker.ts` - Top-level picker (repos, screens, directories, commands)
- `src/branch-picker.ts` - Branch/worktree picker for a specific repo
- `src/picker-store.ts` - Selection frequency tracking
- `src/layout-store.ts` - Layout transition tracking
- `src/layouts.ts` - Fixed layout templates (1-4 panes), `ALL_LAYOUTS` flat list
- `src/layout-preview.ts` - ASCII box-drawing preview renderer
- `src/tmux.ts` - tmux helpers (`getWindows`, `getWindowInfo`, `STARTUP_COMMAND`)
- `src/tmux-layout.ts` - Generates tmux layout strings with checksum
- `src/pane-matcher.ts` - Position-based pane matching for layout transitions
- `src/swap-orchestrator.ts` - Computes and executes pane swap sequences
- `src/repo-store.ts` - Known git repo tracking
- `src/git-utils.ts` - `isGitRepo`, `resolveRepoPath`, `getBranch`, `getLastActivity`
- `src/worktree-utils.ts` - `deleteWorktree` with force fallback
- `src/window-naming.ts` - Window naming from git/directory context
- `src/logger.ts` - Debug log to `/tmp/cmux.log` gated on `CMUX_DEBUG`
- `src/utils.ts` - Shared utilities (name truncation, sanitization)
- `src/box-chars.ts` - Box-drawing character constants

Orphaned (candidates for removal): `src/window-summary.ts`, `src/summaries.ts`, `src/fonts.ts`, `src/dir-picker.ts`. None are imported by `main.ts`.

### UI Structure

```
┌──────────────────────────────────────────────────┐
│  ┌─────────────────¹┐ ┌─────────────────²┐       │
│  │    repo-name     │ │   another-repo   │       │  <- Carousel (always visible)
│  │  branch-name ●   │ │   feature-xyz    │       │
│  └──────────────────┘ └──────────────────┘       │
└──────────────────────────────────────────────────┘
────────────────────────────────────────────────────
     ┌──────────────────────────────────────┐
     │ > search...                          │       <- Middle panel:
     │ ──────────────────────────────────── │         Typeahead (default)
     │ ⚡ → shell                           │         OR Layout picker + form
     │   📦 cmux                            │
     │   📺 other-screen                    │
     │   📁 ~/code                          │
     └──────────────────────────────────────┘
────────────────────────────────────────────────────
 type to filter  jk nav  ⏎ select  tab carousel
```

### Focus Model

Three focus states, navigable with Tab, up/down, and Escape:

**Carousel** (default on startup):
- `h/l` - Move selection left/right
- `j` or `Ctrl+N` - Switch to typeahead
- `Enter` on current window → layout picker; on another window → switch to it and exit
- `1-9` - Quick select window (same Enter semantics)
- `-` or `x` - Delete window (with confirmation)
- `Alt+h/l` - Reorder windows
- `Tab` / `Escape` - Switch to typeahead
- `q` - Quit

**Typeahead** (Tab or down from carousel):
- Type to filter items
- `j/k` or `Ctrl+N/Ctrl+P` - Navigate items (up at top → carousel)
- `Enter` - Select item (switch screen, drill into repo, open directory, run command)
- `Tab` - Switch to carousel
- `Escape` - Quit

**Layout + Form** (Enter on current window from carousel):
- `h/l` - Cycle through layouts (with slide animation)
- `j/k` - Move between layout picker and rename fields (directory, repo, branch)
- `Enter` - Apply layout and exit
- `Escape` - Back to carousel

### Layout Numbering

Panes are numbered largest-to-smallest by area. Layouts cover 1-4 panes (1 + 1 + 4 + 4 = 10 total).

### Data Storage

Single shared SQLite database at `~/.cache/cmux/cmux.sqlite` (no WAL, single-writer). Tables:
- `repos` - Known git repositories with activity tracking
- `picker_frequency` - Selection counts per item type, ordered by frequency
- `transitions` - Layout transition counts for smarter ordering

Additional per-cache DBs are opened by `src/cache.ts` under the same cache directory (WAL-mode, one file per cache name). Used for the AI summary cache in the dead `window-summary.ts` path.

## Building

```bash
bun run build     # bundle to dist/cmux.js
bun run install   # build + install wrapper to ~/.local/bin/cmux
```

Run `bun run build` after code changes before testing interactively — the installed cmux runs the bundle, not the source files.

## Testing

```bash
bun test
```

## Verification

For UI changes, always verify interactively in a real tmux session:

```bash
bun run build
# Then trigger cmux via Alt-Space, or:
tmux new-session -d -s test-cmux
tmux send-keys -t test-cmux 'bun dist/cmux.js' Enter
tmux attach -t test-cmux
```

Unit tests don't catch all UI bugs. Before declaring a fix complete:
1. Actually run the app
2. Test the specific behavior that was changed
3. Verify related functionality still works

