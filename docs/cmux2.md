# cmux v2 Design

## Philosophy

Config-driven, not discovery-based. Typeahead-first. Local and remote screens as peers.

## Startup

Launch drops straight into typeahead. Everything is a destination:
- Existing screens (local tmux windows)
- Configured directories and their children
- Remote host screens

## Picker

Top-level picker shown on startup. Combines all known destinations in one filterable list.

### Sources (in display order)

1. **Existing screens** — running tmux windows (local and remote), always on top
2. **Known repos** — repos you've opened before, sorted by selection frequency
3. **Known hosts** — configured remote hosts, sorted by frequency
4. **Configured directories** — jump roots and their immediate children, sorted by frequency

Worktrees are NOT in this list — they're created through the repo → branch drill-down.

### Drill-down flow

```
Top-level picker
  → Select a screen       → switch to it (or enter layout mode)
  → Select a repo          → branch/worktree picker
  → Select a host          → that host's screens/repos
  → Select a directory     → open new screen there
```

### Frequency tracking

Every selection bumps a counter. Picker items are ordered by frequency (most used first), then recency.

```sql
picker_frequency
  host TEXT DEFAULT 'local'
  type TEXT              -- 'screen' | 'repo' | 'host' | 'directory'
  key TEXT               -- window name, repo path, host name, dir path
  count INTEGER
  last_used_at INTEGER
  PRIMARY KEY (host, type, key)
```

## Data Model (SQLite)

Three tables for user annotations. Git state (branch, dirty) is derived live, never cached.

### hosts

```sql
hosts
  name TEXT PRIMARY KEY     -- "local" | "devbox" | "prod"
  ssh TEXT                  -- null for local, "adam@devbox.internal" for remote
  color TEXT                -- accent color for UI
  nickname TEXT             -- user display name
```

### repos

```sql
repos
  host TEXT DEFAULT 'local'
  path TEXT                 -- canonical repo root (resolved from worktrees)
  nickname TEXT             -- user-assigned name, e.g. "cli"
  PRIMARY KEY (host, path)
```

### branches

```sql
branches
  host TEXT DEFAULT 'local'
  repo_path TEXT            -- FK to repos
  name TEXT                 -- full branch name
  nickname TEXT             -- user-assigned short name
  PRIMARY KEY (host, repo_path, name)
```

### directories

```sql
directories
  host TEXT DEFAULT 'local'
  path TEXT
  show_children BOOLEAN     -- list immediate children in typeahead
  PRIMARY KEY (host, path)
```

### Design principles

- DB holds user intent/annotations only. No cached derived state.
- Git state (repo_path, branch, dirty) is derived live via git calls.
- Display derivation: `repo.nickname ?? basename(repo_path)` for line 1, `branch.nickname ?? branch_name` for line 2.
- Everything is scoped to a host. Same path on different hosts = different entities.
- Repo nicknames are shared across worktrees (worktrees resolve to same repo_path via git).

### Config Editing

TBD — in-app settings screen, subcommand, or both.

## Remote Nested tmux

Biggest new feature. Each configured host runs tmux. Remote windows appear alongside local windows in typeahead and carousel.

- Host discovery: explicit config only (no scanning)
- Remote window list: cached in DB, background refresh via `ssh host tmux list-windows`
- Selecting a remote screen: local pane runs `ssh -t host 'tmux attach -t session \; select-window -t N'`
- Creating remote screens: ssh + `tmux new-window`
- Host color applied as visual indicator throughout UI
- Prefix key collision: TBD (different prefix per nesting level, or send-prefix passthrough)

## UI Structure

```
┌──────────────────────────────────────────────────┐
│  ┌─────────────────¹┐ ┌─────────────────²┐       │
│  │    repo-name     │ │   another-repo   │       │  <- Carousel (always visible)
│  │  branch-name ●   │ │   feature-xyz    │       │
│  └──────────────────┘ └──────────────────┘       │
└──────────────────────────────────────────────────┘
────────────────────────────────────────────────────
     ┌──────────────────────────────────────┐
     │ > search...                          │       <- Middle panel:
     │ ──────────────────────────────────── │         Typeahead (default)
     │   repo-name                          │         OR Layout picker
     │   another-project                    │
     │   ~/code/foo                         │
     └──────────────────────────────────────┘
────────────────────────────────────────────────────
 type to filter  jk nav  ⏎ select  esc back
```

### Middle panel modes

- **Typeahead** (default on startup): Search existing screens, directories, repos. Select to switch or create.
- **Layout picker**: Appears when you select a carousel window and hit Enter. Pick a layout, Enter to apply, Escape to go back to typeahead.

### Carousel

Simplified — no [-] or [+] buttons. Just window boxes.
- Always visible, navigable with h/l/number keys regardless of middle panel mode
- Delete via keybind (- or x) with confirmation
- Create via typeahead
- Host color accent on remote window borders
- Enter on a window → switches middle panel to layout picker for that window

## Layouts

- New screens default to two-pane split
- Smarter ordering: rank by usage history for similar screens, match to current pane count, window dimensions
- Layout history tracked in DB

## Quick Shell (Opt+Shift+1)

A keybind that opens a transient shell prompt. Type a command, it runs in zsh, copies the output to clipboard, and closes. Useful for quick lookups without leaving your workflow.

## Removed

- AI window summaries
- Big font rendering
- Plus/minus carousel buttons
- Filesystem discovery (replaced by config)

## Open Questions

- Typeahead ranking: flat by recency/frequency, or sectioned with headers?
- Remote screen creation: what happens when you pick a host with no screens?
- Config editing UX: in-app vs subcommand vs both
- Two-pane default: always horizontal, or configurable per root/host?
- Git/branch browser: how deep? Just branches, or also PRs/issues?
- Host color application: borders, backgrounds, dots, bars?
- Prefix key strategy for nested tmux
