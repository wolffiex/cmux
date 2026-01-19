# Testing Guide

## Quick Start

```bash
bun test              # Run all tests
bun run typecheck     # TypeScript type checking
bun run lint          # Biome + oxlint
bun run lint:fix      # Auto-fix lint issues
```

## Test Structure

```
test/
├── integration/
│   ├── layout-apply.test.ts   # Pane preservation during layout changes
│   └── ui.test.ts             # Full UI interaction tests
├── dir-picker.test.ts         # Directory picker logic
├── layout-preview.test.ts     # ASCII box drawing
├── layouts.test.ts            # Layout template resolution
├── pane-matcher.test.ts       # Position-based pane matching
├── summaries.test.ts          # Window naming heuristics
├── swap-orchestrator.test.ts  # Pane swap sequence computation
├── tmux-layout.test.ts        # Layout string generation
├── tmux.test.ts               # Tmux command helpers
├── utils.test.ts              # Utility functions
└── window-naming.test.ts      # Git-based window naming
```

**188 tests** across 12 files.

## Unit Tests

Unit tests run without tmux and cover pure logic:

- **Layout string generation** - Checksums, coordinate calculations
- **Pane matching** - Position-based matching algorithm
- **Swap orchestration** - Computing optimal swap sequences
- **Window naming** - Git repo/branch detection heuristics
- **Directory picker** - Filtering, navigation, state management

## Integration Tests

Integration tests require tmux and use isolated sockets:

```typescript
const SOCKET = `cmux_test_${process.pid}`;  // Isolated per test run
tmux("new-session -d -s test -x 120 -y 36");
```

Key behaviors tested:
- **Pane ID preservation** - Existing panes keep their IDs through layout changes
- **Position-based matching** - Panes move to closest matching slots
- **UI rendering** - Window carousel, layout preview, key navigation

### Environment Isolation

Tests use `-f /dev/null` to ignore user tmux config:

```typescript
execSync(`tmux -L ${SOCKET} -f /dev/null ${cmd}`)
```

This prevents failures from user settings like `base-index 1`.

## Key Tmux Behaviors

Understanding these is critical for testing:

1. **Pane IDs are immutable** - `%0`, `%1`, etc. never change for a pane's lifetime
2. **Layout strings specify geometry, not pane assignment** - Tmux ignores pane IDs in layout strings and assigns panes by creation order

### Verifying Pane Preservation

```bash
# Track pane identity
tmux list-panes -F '#{pane_id}:#{pane_pid}'

# Before: %0:1234, %1:5678
# After:  %0:1234, %1:5678  (same = preserved)
```

## Manual Testing

For UI changes, always verify interactively per CLAUDE.md:

```bash
# Start test session
tmux new-session -d -s test-cmux
tmux send-keys -t test-cmux 'bun src/main.ts' Enter
tmux attach -t test-cmux
```

Checklist:
1. Window carousel navigation (h/l, 1-9)
2. Layout preview and selection
3. Pane content preserved after layout apply
4. Directory picker filtering and selection

## Code Quality

### TypeScript

```bash
bun run typecheck
```

Configured in `tsconfig.json` with:
- `noUnusedLocals: true`
- `noUnusedParameters: true`

### Linting

```bash
bun run lint        # Check for issues
bun run lint:fix    # Auto-fix safe issues
bun run format      # Format code
```

Uses Biome (formatting + linting) and oxlint (additional rules).

## CI Considerations

- Unit tests work in CI without tmux
- Integration tests require tmux to be available
- All tests use isolated tmux sockets to avoid conflicts
