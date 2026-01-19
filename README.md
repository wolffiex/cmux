# cmux

Tmux UI helper

## Usage
# alias in your .zshrc
cmux = bun <real path to ./src/main.ts>

```bash
# Outside tmux: starts new session with Alt-Space bound
cmux

# Inside tmux: opens layout UI
# alias in your .zshrc
cmux
```

**Automatically bound in cmux session**
```bash
bind -n M-Space display-popup -w 80% -h 80% -E 'bun /path/to/cmux/src/main.ts'
```

## UI

```
           ┌────────────────────────────────────────────────────────────────────────────────────────┐
           │ ┌────────────────────────────────────────────────────────────────────────────────────┐ │
           │ │ ┌───┐ ┌────────────────¹┐ ┌────────────────²┐ ┌────────────────³┐ ┌───┐            │ │
           │ │ │ − │ │      cmux       │ │    shellbot     │ │      bun ●      │ │ + │            │ │
           │ │ │   │ │                 │ │                 │ │                 │ │   │            │ │
           │ │ └───┘ └─────────────────┘ └─────────────────┘ └─────────────────┘ └───┘            │ │
           │ └────────────────────────────────────────────────────────────────────────────────────┘ │
           │────────────────────────────────────────────────────────────────────────────────────────│
           │                                                                                        │
           │                                              ┌───────────────────┬──────────────────┐  │  
           │                     AI Summary               │                   │                  │  │
           │                     (Planned)                │                   │                  │  │
           │                                              │                   │         2        │  │
           │                                              │                   │                  │  │
           │                                              │                   │                  │  │
           │                                              │         1         ├──────────────────┤  │
           │                                              │                   │                  │  │
           │                                              │                   │                  │  │
           │                                              │                   │         3        │  │
           │                                              │                   │                  │  │
           │                                              └───────────────────┴──────────────────┘  │
           │                                                           3 panes · 5/10               │
           │                                                                                        │ 
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                           What goes here?                                              │
           │                             File picker?                                               │
           │                             Diff viewer?                                               │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │                                                                                        │
           │────────────────────────────────────────────────────────────────────────────────────────│
           │ tab focus  hjkl nav  ⏎ apply                                                           │
           └────────────────────────────────────────────────────────────────────────────────────────┘
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
