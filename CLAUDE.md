# cmux

A simple tmux layout manager with a popup UI.

## Running

```bash
# Outside tmux: starts new session with Alt-Space bound
bun src/main.ts

# Inside tmux: runs UI directly
bun src/main.ts

# Or via tmux popup (80% of terminal)
tmux display-popup -w 80% -h 80% -E 'bun /path/to/cmux/src/main.ts'
```

## Architecture

Single binary (`src/main.ts`) using raw ANSI for fast startup (~23ms).

### Files

- `src/main.ts` - Main UI, key handling, tmux integration
- `src/layouts.ts` - Fixed layout templates (1-4 panes), `ALL_LAYOUTS` flat list
- `src/layout-preview.ts` - ASCII box-drawing preview renderer
- `src/tmux.ts` - tmux helpers (`getWindows`, `getWindowInfo`)
- `src/tmux-layout.ts` - Generates tmux layout strings with checksum

### UI Structure

```
 [−]  window ▼  [+]          <- Window bar (focus: window)
─────────────────────────────
      ┌─────────┬─────┐
      │    1    │  2  │      <- Layout preview
      └─────────┴─────┘
        2 panes · 2/10       <- Layout counter (focus: layout)
─────────────────────────────
 tab focus  hjkl nav  ⏎ apply
```

### Key Bindings

**Window bar focused:**
- `h/l` - Navigate between [−], window name, [+]
- `j/k` - Open window popover (when on name)
- `Enter` - Confirm action ([−] removes, [+] creates)
- `Escape` - Cancel back to name

**Layout area focused:**
- `h/l` - Cycle through layouts

**General:**
- `Tab` - Switch focus between window/layout
- `Enter` - Apply layout and exit (when on layout)
- `q` or `Escape` - Quit

### Layout Numbering

Panes are numbered largest-to-smallest by area.

## Testing

```bash
bun test
```

## Branch

Currently on `v2-rewrite` branch - complete rewrite from the original 3-binary architecture.
