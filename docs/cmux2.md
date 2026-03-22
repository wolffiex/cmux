# cmux v2 Design

## Philosophy

Config-driven, not discovery-based. Typeahead-first. Local and remote screens as peers.

## Startup

Launch drops straight into typeahead. Everything is a destination:
- Existing screens (local tmux windows)
- Configured directories and their children
- Remote host screens

## Typeahead

Unified fuzzy finder as the primary interface. Sources:

- **Screens**: Running tmux windows (local and remote)
- **Directories**: Configured jump roots and their immediate children
- **Worktrees**: Git worktrees for configured repos
- **Remote screens**: tmux windows on configured remote hosts

Flat list, filterable. Selecting a destination switches to it (or creates it).

Creation flows:
- Select a directory → opens new screen there (two-pane split default)
- Select a remote host → ssh + attach to remote tmux
- Git browser: pick repo → pick branch → create worktree → open screen

## Configuration (SQLite)

### Directory Roots

Registered paths whose immediate children are also jump targets:

```
~/code         (children: yes)  → ~/code/cmux, ~/code/foo, ...
~/.config      (children: yes)
~/notes        (children: no)   → just ~/notes itself
```

### Remote Hosts

```
hosts:
  devbox:
    ssh: adam@devbox.internal
    color: blue
  prod:
    ssh: adam@prod-bastion
    color: red
```

Each host has an assigned color/color scheme. Remote screens display with that color accent in the carousel and elsewhere.

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

## Carousel

Simplified — no [-] or [+] buttons. Just window boxes.
- Delete via keybind (- or x) with confirmation
- Create via typeahead
- Host color accent on remote window borders

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
