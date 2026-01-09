# Testing Strategy for Layout Changes that Preserve Pane Positions

## Executive Summary

Testing layout application in cmux requires understanding two key tmux behaviors:
1. **Pane IDs are immutable** - `%0`, `%1`, etc. never change for the lifetime of a pane
2. **Layout strings specify pane order, but tmux ignores it** - When applying a layout, tmux uses geometry but assigns panes in their natural order (lowest pane_id first)

This means the "churning" problem is NOT about pane IDs being swapped in the layout string. Instead, it's about:
- Unnecessary `split-window`/`kill-pane` operations
- Potentially closing panes running important processes

## Existing Test Infrastructure

### Unit Tests (work in CI)
- `test/tmux-layout.test.ts` - Tests layout string generation with checksum
- `test/layouts.test.ts` - Tests layout template resolution to absolute coordinates
- `test/layout-preview.test.ts` - Tests ASCII box drawing for preview

### Integration Tests (require tmux)
- `test/integration/ui.test.ts` - Full UI tests requiring real tmux session
- Currently failing in CI (no tmux session available)
- Uses isolated tmux socket per test

### Test Infrastructure Helpers
```typescript
// From test/integration/ui.test.ts
const SOCKET = `cmux_test_${process.pid}`  // Isolated socket per test
function tmux(cmd: string): string         // Execute tmux command
function capture(): string                 // Capture pane content
function sendKeys(keys: string): void      // Send keystrokes
```

## Key Finding: Pane ID Behavior

**Experiment conducted:**
```bash
# Created 2 panes: %6 at top, %7 at bottom
# Applied layout string with %7 at top, %6 at bottom
# Result: tmux IGNORED the pane IDs and kept %6 at top, %7 at bottom
```

The layout string `41b4,80x24,0,0[80x12,0,0,7,80x11,0,13,6]` was normalized by tmux to `c1b0,80x24,0,0[80x12,0,0,6,80x11,0,13,7]`.

**Conclusion:** Pane IDs in the layout string are hints that tmux ignores. It preserves the existing pane assignment order.

## Scenarios That Need Testing

### 1. Same Pane Count - Resize Only (Should be no-op for processes)
**Scenario:** 2 panes exist, apply 2-pane layout
**Expected:**
- No `split-window` or `kill-pane` calls
- Only `select-layout` with new geometry
- Pane content preserved (vim still vim, etc.)

**Test approach:** Unit test - mock execSync, verify only `select-layout` is called

### 2. Adding Panes (Current panes stay, new ones added)
**Scenario:** 2 panes exist, apply 3-pane layout
**Expected:**
- One `split-window` call
- Existing panes %0, %1 preserved
- New pane %2 created
- Layout applied with all 3 panes

**Test approach:** Integration test - verify pane_id/pane_pid preservation

### 3. Removing Panes (Controversial - should probably warn)
**Scenario:** 3 panes exist, apply 2-pane layout
**Current behavior:** Calls `kill-pane` for extras
**Problem:** May kill important processes without warning
**Test approach:** Test current behavior, document limitation

### 4. Layout change same pane count (Just rearrangement)
**Scenario:** 2 panes horizontal, apply 2 panes vertical
**Expected:**
- No pane creation/destruction
- Only geometry change
- Content stays in same panes

**Test approach:** Integration test tracking pane_id positions

## How to Verify Pane Identity Preservation

```bash
# Track pane identity using immutable pane_id and pane_pid
tmux list-panes -F '#{pane_id} #{pane_pid}'

# Before layout: %0 pid=1234, %1 pid=5678
# After layout: %0 pid=1234, %1 pid=5678 (same PIDs = preserved)
```

Key assertion:
```typescript
// Before
const before = execSync("tmux list-panes -F '#{pane_id}:#{pane_pid}'").toString()
// Apply layout
applyLayout(...)
// After
const after = execSync("tmux list-panes -F '#{pane_id}:#{pane_pid}'").toString()

// If pane count unchanged, all pane_id:pane_pid pairs should match
expect(before).toBe(after)
```

## Recommended Test Types

### Unit Tests (No tmux required)
1. **Layout string generation** - Already covered
2. **Pane count delta calculation** - New test needed
3. **Mock-based apply verification** - Verify correct tmux commands issued

Example mock-based test:
```typescript
test("same pane count only calls select-layout", () => {
  const commands: string[] = []
  jest.mock("child_process", () => ({
    execSync: (cmd: string) => { commands.push(cmd); return "" }
  }))

  // Setup: 2 panes, apply 2-pane layout
  applyLayout(layout2pane, mockWindowWith2Panes)

  expect(commands).not.toContain(expect.stringMatching(/split-window/))
  expect(commands).not.toContain(expect.stringMatching(/kill-pane/))
  expect(commands).toContain(expect.stringMatching(/select-layout/))
})
```

### Integration Tests (Require tmux)
1. **Pane preservation on resize** - Track pane_pid through layout change
2. **Pane addition** - Verify existing panes untouched
3. **Pane ordering** - Verify pane positions match layout

Example integration test:
```typescript
test("applying same-count layout preserves pane PIDs", async () => {
  // Setup 2 panes
  tmux("split-window -h")
  const before = tmux("list-panes -F '#{pane_id}:#{pane_pid}'")

  // Apply 2-pane vertical layout (same count, different orientation)
  tmux("select-layout even-vertical")

  const after = tmux("list-panes -F '#{pane_id}:#{pane_pid}'")

  // Pane IDs and PIDs should be unchanged
  expect(after).toBe(before)
})
```

### Manual Verification Checklist
For UI changes per CLAUDE.md:
1. Start test session: `tmux new-session -d -s test-cmux`
2. Create multiple panes with identifiable content
3. Run cmux: `bun src/main.ts`
4. Apply layout, verify panes didn't swap content

## Recommended Test File Structure

```
test/
  unit/
    pane-delta.test.ts       # Test pane count change calculations
    layout-command.test.ts   # Test tmux command generation (mocked)
  integration/
    layout-apply.test.ts     # Test actual layout application
    pane-preservation.test.ts # Test pane identity preserved
    ui.test.ts               # Existing UI tests
```

## Questions for Implementation

1. **Should removing panes require confirmation?** Current code blindly kills extras
2. **How to handle pane order in layout?** tmux ignores pane IDs, so largest-to-smallest numbering in preview is cosmetic only
3. **Should we track which pane is "primary"?** e.g., keep the active pane as pane 1

## Next Steps

1. Create unit tests for pane count delta logic (no tmux needed)
2. Add integration tests for pane preservation (need tmux)
3. Consider refactoring applyAndExit to:
   - Skip operations when no change needed
   - Warn before killing panes with running processes
   - Document that pane order in layout preview != actual pane mapping
