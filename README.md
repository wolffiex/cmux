# cmux

A fast tmux layout manager with a popup UI.

## Features

- **Window carousel** - Visual horizontal selector for switching, creating, and deleting windows
- **10 fixed layouts** - Preset layouts for 1-4 panes (full, split, stacked, grid)
- **Window reordering** - Move windows left/right with Alt+h/l (animated)
- **Smart pane matching** - Preserves pane positions when changing layouts
- **Intelligent naming** - Windows auto-named from git repo/branch or directory
- **Fast startup** - Raw ANSI rendering, ~22ms startup time
- **AI summaries** - Context-aware summaries for each window (requires Anthropic API key)
- **Directory picker** - Create new windows in any directory with typeahead filtering

## Installation

**Requirements:**
- tmux 3.2+
- Bun

## Usage

```zsh
alias cmux=bun <path to ./src/main.ts>
```

```zsh
# Outside tmux: starts or attaches to "cmux" session with Alt-Space bound
cmux

# Inside tmux: opens the layout UI directly
cmux
```

When run outside tmux, cmux creates a session named "cmux" and binds Alt-Space to open the UI as a popup. If the session already exists, it attaches to it.

## UI Overview

```
       ┌───────────────────────────────────────────────────────────────────────────────┐
       │ ┌───────────────────────────────────────────────────────────────────────────┐ │
       │ │ ┌───┐ ┌────────────────¹┐ ┌────────────────²┐ ┌────────────────³┐ ┌───┐   │ │
       │ │ │ − │ │      cmux       │ │    shellbot     │ │      bun ●      │ │ + │   │ │
       │ │ │   │ │                 │ │                 │ │                 │ │   │   │ │
       │ │ └───┘ └─────────────────┘ └─────────────────┘ └─────────────────┘ └───┘   │ │
       │ └───────────────────────────────────────────────────────────────────────────┘ │
       │───────────────────────────────────────────────────────────────────────────────│
       │                                                                               │
       │                                   ┌───────────────────┬──────────────────┐    │
       │          AI Summary               │                   │                  │    │
       │                                   │                   │                  │    │
       │                                   │                   │         2        │    │
       │                                   │                   │                  │    │
       │                                   │                   │                  │    │
       │                                   │         1         ├──────────────────┤    │
       │                                   │                   │                  │    │
       │                                   │                   │                  │    │
       │                                   │                   │         3        │    │
       │                                   │                   │                  │    │
       │                                   └───────────────────┴──────────────────┘    │
       │                                                3 panes · 5/10                 │
       │                                                                               │ 
       │                                                                               │
       │                                                                               │
       │                                                                               │
       │                                                                               │
       │                What goes here?                                                │
       │                  File picker?                                                 │
       │                  Diff viewer?                                                 │
       │                                                                               │
       │                                                                               │
       │                                                                               │
       │───────────────────────────────────────────────────────────────────────────────│
       │ tab focus  hjkl nav  ⏎ apply                                                  │
       └───────────────────────────────────────────────────────────────────────────────┘
```
## Key Bindings

### Window Carousel (top)

| Key | Action |
|-----|--------|
| `h` / `l` | Move selection left/right |
| `j` | Move focus to layout area |
| `Enter` | Switch to window, or activate `[-]`/`[+]` button |
| `1`-`9` | Quick select window by number |
| `-` or `x` | Delete current window (with confirmation) |
| `+` or `=` | Create new window |
| `Alt+h` / `Alt+l` | Reorder: move current window left/right |

### Layout Area (bottom)

| Key | Action |
|-----|--------|
| `h` / `l` | Cycle through layouts (with slide animation) |
| `k` | Move focus to window carousel |
| `Enter` | Apply layout and exit |

### General

| Key | Action |
|-----|--------|
| `Tab` | Switch focus between carousel and layout |
| `Escape` / `q` | Quit (or cancel delete confirmation) |
| Arrow keys | Same as `hjkl` |

## Layouts

Fxed layouts organized by pane count.

Data-driven layouts; intended for customization

Panes are numbered largest-to-smallest by area.

## Configuration

| File | Description |
|------|-------------|
| `~/.config/cmux/api-key` | Anthropic API key for AI summaries (created by `--install` if `ANTHROPIC_API_KEY` is set) |
| `~/.config/cmux/repos` | Repo name aliases for window naming (format: `long-repo-name=short`) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Fallback API key (used if config file doesn't exist) |
| `CMUX_DEBUG=1` | Enable debug logging to `/tmp/cmux.log` |
| `CMUX_BENCHMARK=1` | Headless mode for benchmarking |

## Development

```bash
bun test              # Run tests
bun src/main.ts       # Run directly
```

