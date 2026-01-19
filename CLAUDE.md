# cmux

A simple tmux layout manager with a popup UI.

## Installation

```bash
bun install
bun link
```

This installs `cmux` globally so you can run it from anywhere.

## Running

```bash
# Outside tmux: starts or attaches to "cmux" session with Alt-Space bound
cmux

# Inside tmux: runs UI directly
cmux

# Or via tmux popup (80% of terminal)
tmux display-popup -w 80% -h 80% -E cmux
```

When run outside tmux, cmux creates a session named "cmux". If that session already exists, it attaches to it instead of creating a new one.

## Environment Variables

- `CMUX_DEBUG=1` - Enables debug logging to `/tmp/cmux.log`
- `CMUX_BENCHMARK=1` - Headless mode for benchmarking (exits after init)

## Architecture

Single binary (`src/main.ts`) using raw ANSI for fast startup (~22ms).

### Files

- `src/main.ts` - Main UI, key handling, tmux integration
- `src/layouts.ts` - Fixed layout templates (1-4 panes), `ALL_LAYOUTS` flat list
- `src/layout-preview.ts` - ASCII box-drawing preview renderer
- `src/tmux.ts` - tmux helpers (`getWindows`, `getWindowInfo`)
- `src/tmux-layout.ts` - Generates tmux layout strings with checksum
- `src/dir-picker.ts` - Directory picker overlay with typeahead filtering
- `src/pane-matcher.ts` - Position-based pane matching for layout transitions
- `src/swap-orchestrator.ts` - Computes and executes pane swap sequences
- `src/window-naming.ts` - Intelligent window naming from git/directory context
- `src/utils.ts` - Shared utilities (name truncation, sanitization)
- `src/box-chars.ts` - Box-drawing character constants

### UI Structure

```
┌──────────────────────────────────────────────────┐
│ ╔═══╗ ┌─────────────────¹┐ ┌─────────────────²┐  │
│ ║ − ║ │    repo-name     │ │   another-repo   │  │  <- Window carousel
│ ║   ║ │  branch-name ●   │ │   feature-xyz    │  │     (focus: window)
│ ╚═══╝ └──────────────────┘ └──────────────────┘  │
└──────────────────────────────────────────────────┘
────────────────────────────────────────────────────
            ┌─────────────┬───────┐
            │      1      │   2   │                    <- Layout preview
            └─────────────┴───────┘
               2 panes · 2/10                          <- Layout counter
────────────────────────────────────────────────────      (focus: layout)
 tab focus  hjkl nav  ⏎ apply
```

The window selector is a **horizontal carousel**, not a dropdown:
- `[-]` delete button on the left (double-line border when selected)
- Window boxes showing repo/branch on two lines, with superscript numbers (1-9)
- `[+]` create button on the right
- Current window marked with `●`
- Selected item has bright double-line border, others have dim single-line borders

### Key Bindings

**Window carousel focused:**
- `h/l` - Move selection left/right in carousel
- `j` - Move focus down to layout area
- `Enter` - Select window to switch, or activate [-]/[+] button
- `1-9` - Quick select window by number
- `-` - Show delete confirmation for current window
- `+` or `=` - Open directory picker for new window

**Layout area focused:**
- `h/l` - Cycle through layouts (with slide animation)
- `k` - Move focus up to window carousel

**General:**
- `Tab` - Switch focus between window carousel and layout area
- `Enter` - Apply layout and exit (when on layout)
- `q` or `Escape` - Quit (or cancel delete confirmation)

### Layout Numbering

Panes are numbered largest-to-smallest by area.

## Testing

```bash
bun test
```

## Verification

For UI changes, always verify interactively in a real tmux session:

```bash
# Start a test session
tmux new-session -d -s test-cmux
tmux send-keys -t test-cmux 'bun src/main.ts' Enter
tmux attach -t test-cmux
```

Unit tests don't catch all UI bugs. Before declaring a fix complete:
1. Actually run the app
2. Test the specific behavior that was changed
3. Verify related functionality still works

