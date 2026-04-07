# Testing Guide

cmux has three layers of verification: unit tests, tmux-backed integration tests, and VHS-based visual verification. Use all three — they each catch different classes of bug.

## Quick Start

```bash
bun test              # unit + integration tests
bun run typecheck     # tsc --noEmit
bun run lint          # biome check + oxlint
bun run lint:fix      # auto-fix safe issues
```

For UI changes, also run the VHS tapes — see "Visual verification" below.

## Test layout

```
test/
├── vhs/
│   ├── carousel-default.tape   # baseline boot screenshot
│   ├── layout-picker.tape      # carousel Enter → layout picker
│   └── shell-hint-cwd.tape     # shell hint cwd across navigation
├── branch-picker.test.ts
├── layout-preview.test.ts
├── layouts.test.ts
├── pane-matcher.test.ts
├── picker-store.test.ts
├── swap-orchestrator.test.ts
├── tmux-layout.test.ts
├── tmux.test.ts
├── utils.test.ts
└── window-naming.test.ts

src/
├── typeahead.test.ts           # colocated: fuzzy-path + key handling
└── resumable-filter.test.ts    # colocated: resumable BFS scan
```

## Unit tests

Unit tests run without tmux and cover pure logic:

- **Layout string generation** — `tmux-layout.test.ts`: checksum computation, tree building, serialization.
- **Layout templates** — `layouts.test.ts`: coordinate resolution, negative-value encoding, usable-width math.
- **Pane matching** — `pane-matcher.test.ts`: overlap scoring, center-distance fallback, top-bias multiplier.
- **Swap orchestration** — `swap-orchestrator.test.ts`: selection-sort swap sequences.
- **Window naming** — `window-naming.test.ts`: git repo/branch heuristics, alias file parsing.
- **Pickers** — `branch-picker.test.ts`, `picker-store.test.ts`: filter/selection logic.
- **Typeahead + resumable filter** — `src/typeahead.test.ts`, `src/resumable-filter.test.ts`: fuzzy matching, narrow-vs-reset, BFS state.
- **Utilities** — `utils.test.ts`: truncation, ansi stripping, sanitization.

`picker-store.test.ts` uses the real shared DB and calls `_clearAll()` in `beforeEach` for isolation.

## Visual verification (VHS)

cmux is a pure-ANSI TUI with significant rendering state: three focus modes, carousel highlighting and dimming, layout previews, and centred content. Unit tests cannot tell you whether any of that actually *looks* right. VHS closes that loop.

[VHS](https://github.com/charmbracelet/vhs) runs a terminal program inside a headless virtual terminal, executes a scripted sequence of keystrokes, and emits a PNG. An agent can read the PNG directly, so the verification loop closes without a human in the middle.

### Install

```bash
brew install vhs
```

### Run a tape

```bash
bun run build                           # IMPORTANT — see gotcha #1
vhs test/vhs/carousel-default.tape      # writes screenshots/carousel-default.png
```

The `screenshots/` directory is gitignored. PNGs are ephemeral; tapes are the source of truth.

### Authoring a tape

Tapes are line-oriented scripts in a small DSL. The canonical layout:

```
Set Width 120
Set Height 36
Set FontSize 14
Set Theme "Dracula"

Hide
Type "bun dist/cmux.js"
Enter
Sleep 400ms
Show

# interaction
Tab
Sleep 200ms

Screenshot screenshots/carousel-default.png
```

The `Hide`/`Show` wrapper keeps the shell prompt and the `bun dist/cmux.js` launch line out of the screenshot. `Sleep` is **load-bearing**: cmux has async init (deferred picker construction, the 1500 ms tmux poll) and screenshotting too early catches a half-rendered frame. Reliable ranges:

- 300–500 ms after the launch `Enter`.
- 200–300 ms after each interactive keypress.

### Canonical workflow

1. Make a code change.
2. `bun run build`.
3. `vhs test/vhs/<name>.tape`.
4. Read the PNG. Iterate.

### Gotchas

1. **Always run `bun run build` before running a tape.** VHS executes `dist/cmux.js`, not `src/main.ts`. Forgetting this means you're screenshotting stale code, and it is the single most common mistake.
2. **VHS shares your real tmux server.** cmux shells out to `tmux list-windows`, so if you have a tmux server running you'll see your real windows in the screenshot instead of the `backend` / `frontend` / `logs` fallback fixtures (`src/main.ts:133-161`). For hermetic output, run with `env -u TMUX` or a throwaway socket.
3. **Sleep is load-bearing.** See the ranges above.
4. **Screenshots are gitignored.** Don't try to check them in under `screenshots/`. The tapes are the source of truth. Docs images are a separate story — see the PNG plan in the docs workflow.
5. **No assertion layer.** VHS gives you a PNG, not a diff. Regression detection means eyeballing (or agent-reading) the image. For automated regression you would need to either bolt image-diff on top or extract rendering into a pure `renderToString()` function whose ANSI output you can snapshot.
6. **The tape DSL is space-sensitive.** Use the existing tapes as templates; quoting rules inside `Type` arguments bite people.

## Code quality

### TypeScript

```bash
bun run typecheck
```

Configured in `tsconfig.json` with `noUnusedLocals: true` and `noUnusedParameters: true`.

### Linting

```bash
bun run lint        # biome + oxlint
bun run lint:fix    # auto-fix safe issues
bun run format      # format code
```

## CI considerations

- Unit tests run in CI without tmux.
- VHS is not wired into CI; it's a local verification loop.
