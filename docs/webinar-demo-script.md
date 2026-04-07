# Webinar Demo Script — Claude Controls cmux

Feature being demoed: a `cmux` CLI plus a Claude Code skill that teaches Claude
when and how to drive cmux. Built by a fleet of forked subagents, coordinated
live in the coordinator panel.

## Framing (60s)

cmux is a typeahead-first tmux workspace manager. Today it's driven by a human
at the keyboard. The demo shows what happens when Claude becomes a first-class
cmux actor: opening worktrees, spawning windows, switching layouts, reporting
status back into the carousel — all from inside a running Claude Code session.

The build itself is the second half of the story. We'll ship the feature live
with a small fleet of forked subagents, each owning one slice of the work, all
visible in the coordinator panel.

## Act 1 — The problem (90s)

Live, in a cmux popup:

1. "I want to fix three small issues in this repo at once." Narrate the manual
   flow: open typeahead, create worktree 1, switch, start Claude, back to
   carousel, create worktree 2, switch, start Claude, and so on. Make the
   friction visible.
2. Punchline: "Claude already knows what it wants to do. Why is the human the
   bottleneck on opening windows?"

## Act 2 — The build, in parallel (6–8 min)

Switch to a Claude Code session. One prompt:

> Build a `cmux` CLI and a matching Claude Code skill so a Claude session can
> drive cmux from inside a pane. Commands to support: `worktree create`,
> `window list`, `window focus`, `layout set`, `status set`. Fork the work
> across subagents.

What the audience sees in the coordinator panel:

- **fork A — CLI surface.** Designs `cmux <command> --json`, wires argument
  parsing, writes the dispatcher. Blocks the others until the command table
  lands.
- **fork B — IPC transport.** A unix socket under `$XDG_RUNTIME_DIR/cmux/` so
  the CLI talks to the running popup. Depends on A's command shapes.
- **fork C — skill package.** `SKILL.md` plus trigger docs — "when the user
  asks to work on multiple things at once, reach for cmux." Can start
  immediately; only needs A's command names, not implementations.
- **fork D — carousel status badges.** Adds a status field to windows, renders
  a colored dot in the carousel, reads from the IPC. Independent of A/B until
  integration.

Narrate the coordinator panel as forks land: C finishes first (docs-only),
then A, then D, then B integrates. Point out the moments where one fork
pauses on another — that's the whole reason the panel exists.

## Act 3 — The payoff (2 min)

Rebuild cmux, reopen the popup, and re-run the opening prompt from Act 1:

> Fix these three issues in parallel: #101, #102, #103.

This time Claude calls `cmux worktree create` three times, spawns three
windows, labels each with the issue number via `cmux status set`, and the
carousel fills up with three active badges. The human watches.

Close on: "The feature we built to let Claude control cmux was itself built
by Claude controlling Claude. The coordinator panel is the thing that made
both halves legible."

## Backup / failure plan

- If a fork stalls live, cut to a pre-recorded VHS tape of the same build.
- If the IPC socket misbehaves, fall back to `cmux` reading stdin JSON — A's
  dispatcher supports both.
- Keep the three-issue prompt scripted so Act 3 is deterministic.

## Open questions for rehearsal

- Socket location on macOS (no `$XDG_RUNTIME_DIR` by default).
- Whether the skill ships in-repo or as a separate package for the demo.
- How loud the carousel badge animation should be for a webinar audience.
