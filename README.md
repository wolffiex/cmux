# cmux

A better interface for tmux.

## Three binaries

| Binary | Purpose |
|--------|---------|
| `cmux` | Typeahead search/command palette |
| `cmuxx` | Launcher - gets tmux context, opens popup |
| `cmuxx-ui` | Visual layout UI (runs inside popup) |

### `cmux` - typeahead

Fast prompt with deterministic completions.

```
> back|
  backend         npm run dev, :3000
  backend-test    npm test, 14 passed
```

**Input:**
- Type to filter completions
- `Tab` to complete/cycle
- `Enter` to execute
- All input treated as prompt: `> run tests on backend`

**Navigation (vim-style):**
- `Esc` then `j`/`k` to move through completions
- `Ctrl+N` / `Ctrl+P` also work
- `Enter` to select

**Search architecture:**

Multiple sources queried concurrently with per-source debounce:
```
panes      (0ms)   ─┐
sessions   (0ms)   ─┼─→ merge → needle filter → render
fzf        (30ms)  ─┤
haiku      (200ms) ─┘
```

Cache is a DAG of prefixes. Each node seeded from predecessor's filtered items, then appended to. Backspace is instant.

**Implementation:**
- `node:readline` for keypress events (built into Bun)
- Raw ANSI for rendering
- AbortController for cancelling stale queries
- Target: <20ms per keystroke

### `cmuxx` - visual layout

Two-stage architecture:

**`cmuxx`** (launcher)
1. Query tmux for window size and pane info
2. Calculate optimal popup size to fit the mini-map
3. Invoke `cmuxx-ui` inside `display-popup` with pane data as args

**`cmuxx-ui`** (runs in popup)
1. Parse pane data from args
2. Draw mini-map
3. Handle input (browse layouts, add/remove)
4. On Space: `exec cmux` (replaces self with typeahead)
5. On Enter: exit with action for launcher to execute

```
┌─────────────────────────────────────────┐
│  3 panes              [←] [→] layout 1/5│
│                                         │
│  ┌─────────┬─────────┐                  │
│  │         │         │                  │
│  │ backend │frontend │                  │
│  │    ●    │    ●    │                  │
│  ├─────────┴─────────┤                  │
│  │       logs        │                  │
│  │         ○         │                  │
│  └───────────────────┘                  │
│                                         │
│  [+] add   [-] remove   [Space] cmux    │
└─────────────────────────────────────────┘
```

**Controls:**
- `+`/`-` add/remove panes (recalculates monte carlo layouts)
- `←`/`→` browse layout variants
- `Space` open cmux typeahead
- `Enter` apply and exit

**Why two programs:**
- Launcher knows tmux context, calculates popup size
- UI is pure rendering, receives data as args, outputs action
- Clean separation, each does one thing

---

## Entry points

**From shell (outside tmux):**
```bash
cmux                # Start/resume a session
```

**From inside tmux:**
```
Alt+Space           # Opens cmuxx (visual layout)
                    # Then Space inside cmuxx opens cmux typeahead
```

**The flow:**
```
Alt+Space
  → cmuxx (launcher)
    → queries tmux for panes/size
    → calculates popup dimensions
    → runs: tmux display-popup "cmuxx-ui --panes=..."
      → cmuxx-ui draws minimap
      → user presses Space
        → exec cmux (replaces cmuxx-ui in same popup)
        → cmux runs, user executes action, exits
      → OR user presses Enter
        → exits with layout action
    → popup closes, cmuxx reads exit/output
    → cmuxx applies result (layout change, command, etc.)
```

---

## Core features

### 1. Session management

Sessions are project-based and context-aware.

```bash
cmux                        # Smart start/resume (or typeahead if inside)
cmux new [dir]              # New session for directory
cmux resume                 # Pick from recent sessions
cmux stop                   # End current session
```

**What cmux tracks:**
- Project directory
- Git branch
- Running commands per pane
- Pane labels
- Last active time

### 2. Layout system

`cmuxx` is the visual layout editor. Add/remove panes and it figures out the best arrangement.

Uses monte carlo: generate random subdivisions, score by aspect ratio (~2:1) and minimum size, pick the best.

Browse layout variants with arrow keys, apply with enter.

### 3. Notifications

```bash
cmux notify <pane> --on silence    # Build done
cmux notify <pane> --on pattern "error|fail"
cmux notify <pane> --on activity
```

Desktop notifications, status bar, optional webhook.

### 4. AI summaries

Powered by Claude Haiku.

```bash
cmux summarize              # What's happening in all panes?
cmux catch-up               # What did I miss?
cmux auto-label             # Haiku names current pane
```

### 5. Settings management

cmux wraps tmux. Your `~/.tmux.conf` stays untouched.

```bash
cmux init                   # Initial setup
cmux config                 # Edit settings
```

cmux maintains `~/.config/cmux/tmux.conf` and layers it on top.

---

## Keybindings

**In tmux (no prefix):**

| Key | Action |
|-----|--------|
| `Alt + Space` | Open `cmuxx` |
| `Alt + h/j/k/l` | Navigate panes directly |

**Inside `cmuxx-ui`:**

| Key | Action |
|-----|--------|
| `Space` | Open `cmux` typeahead |
| `+` / `-` | Add / remove pane |
| `←` / `→` | Browse layout variants |
| `Enter` | Apply layout and exit |
| `Esc` | Cancel |

**Inside `cmux` typeahead:**

| Key | Action |
|-----|--------|
| Type | Filter completions |
| `Tab` | Cycle completions |
| `Ctrl+N/P` or `j/k` (after Esc) | Navigate list |
| `Enter` | Execute |
| `Esc` | Back to cmuxx-ui |

---

## Installation

```bash
bun install -g cmux
cmux init
cmux
```

**Requirements:**
- tmux 3.2+
- Bun
- ANTHROPIC_API_KEY (optional, for AI features)
