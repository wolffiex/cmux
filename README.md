# cmux

A simple tmux layout manager.

## Usage

```bash
# Outside tmux: starts new session with Alt-Space bound
cmux

# Inside tmux: opens layout UI
cmux
```

**Or bind to a key in tmux:**
```bash
bind -n M-Space display-popup -w 80% -h 80% -E 'bun /path/to/cmux/src/main.ts'
```

## UI

```
 [−]  window ▼  [New window]
─────────────────────────────────────
              ┌─────────┬─────┐
              │    1    │  2  │
              └─────────┴─────┘
                2 panes · 2/10
─────────────────────────────────────
 tab focus  hjkl nav  ⏎ apply
```

### Controls

**Window bar (top):**
- `h/l` - Select [−], window name, or [+]
- `j/k` - Open window list (when on name)
- `Enter` - Remove window ([−]) or create new ([+])

**Layout area:**
- `h/l/j/k` - Cycle through fixed layouts

**General:**
- `Tab` - Switch focus between window bar and layout
- `Enter` - Apply selected layout
- `Escape` / `q` - Quit

## Layouts

10 fixed layouts for 1-4 panes:
- 1 pane: full
- 2 panes: 50/50 vertical
- 3 panes: 4 variants (main left/right with stacked)
- 4 panes: 4 variants (grid, stacked combinations)

Panes are numbered largest-to-smallest.

## Installation

```bash
bun install
bun src/main.ts
```

**Requirements:**
- tmux 3.2+
- Bun

## Development

```bash
bun test                    # Run tests
bun src/main.ts             # Run directly
bun src/layout-preview.ts   # Preview layouts in terminal
```
