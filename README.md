# cmux

A typeahead-first workspace manager for tmux. Fuzzy-find repos, screens, and directories, manage worktrees, and switch layouts without losing pane content — all from a popup that opens in ~16 ms.

## Install

Requires tmux 3.2+ and [Bun](https://bun.sh/).

```bash
git clone <this-repo> && cd cmux
bun run install
```

This builds `dist/cmux.js` and writes a wrapper script to `~/.local/bin/cmux`. Make sure `~/.local/bin` is on your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Run

```bash
cmux
```

- **Outside tmux**, cmux launches (or attaches to) a tmux session named `cmux` with `Alt-Space` bound to open the popup.
- **Inside tmux**, cmux opens the popup directly.

The wrapper uses an `exec` plus `eval` trick to replace the current shell with tmux, so environment variables don't leak into child processes.

## Features

- **Typeahead picker** — a unified fuzzy finder for repos, open screens, directories, and commands. Ranked by selection frequency.
- **Carousel** — an always-visible strip of tmux windows with repo/branch labels. Navigate, reorder, and delete with a single keystroke.
- **Layout picker** — 10 fixed layouts covering 1–4 panes. Applying a layout **preserves pane content**: cmux matches existing panes to target slots by position and only creates or kills panes as needed.
- **Branch picker** — drill into a repo to see its worktrees and branches, and create new worktrees from `origin/main` in one keystroke.
- **Quick shell** — the `⚡ shell` picker item spawns a persistent login shell in the selected window's working directory. On macOS, single-command output is captured and copied to the clipboard.
- **Smart window naming** — windows are auto-named from git repo and branch on cmux startup, with alias overrides from `~/.config/cmux/repos`.
- **Frequency tracking** — picker items and layout choices are ranked by how often you use them.
- **Fast startup** — ~16 ms popup-to-interactive, using process substitution to prefetch tmux data in parallel with Bun's module load.

## Keybindings

### Carousel

| Key | Action |
|---|---|
| `h` / `l` | move left/right |
| `1`-`9` | jump to window N |
| `Enter` / `Space` | current window → layout picker; other → switch and exit |
| `-` / `x` | delete window (press again to confirm) |
| `Alt-h` / `Alt-l` | swap with neighbor (animated) |
| `j` / `Tab` | back to typeahead |
| `q` | quit |

### Typeahead

| Key | Action |
|---|---|
| type | filter |
| `↑` / `↓` | navigate (at top → carousel) |
| `Enter` | select (or "create" if nothing matches) |
| `Tab` | to carousel |
| `Escape` | quit |

### Layout picker

| Key | Action |
|---|---|
| `h` / `l` | cycle layouts |
| `j` / `k` | move between fields |
| `Enter` | apply layout and exit |
| `Escape` | back to carousel |

## Configuration

| File | Purpose |
|---|---|
| `~/.cache/cmux/cmux.sqlite` | frequency, known repos, layout transitions |
| `~/.config/cmux/repos` | `long-name=short-name` aliases for window labels |

Respects `XDG_CACHE_HOME` and `XDG_CONFIG_HOME`.

## Environment variables

| Variable | Effect |
|---|---|
| `CMUX_DEBUG=1` | writes debug log to `/tmp/cmux.log` |
| `CMUX_BENCHMARK=1` | headless mode; exits after first render |

## Documentation

- [User Guide](docs/USER_GUIDE.md) — full walkthrough of every feature and keybinding.
- [Architecture](docs/ARCHITECTURE.md) — developer-oriented map of the codebase.
- [Testing](docs/TESTING.md) — unit, integration, and VHS-based UI verification.
- [v2 Design Notes](docs/cmux2.md) — historical design doc; mixes shipped and aspirational sections.

## Development

```bash
bun src/main.ts       # run from source
bun run build         # bundle to dist/cmux.js
bun test              # run the full suite
bun run typecheck     # tsc --noEmit
bun run lint          # biome + oxlint
```

Run `bun run build` after code changes, before interactive testing. The installed `cmux` wrapper runs the bundle, not the source files.
