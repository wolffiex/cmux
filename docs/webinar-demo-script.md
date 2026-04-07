# Webinar Demo Script — Building `cmux <cmd>` with Forked Subagents

The feature is `cmux <argv...>` — a CLI that adds a pane to the current tmux
window and runs the given command in it. The new pane lands in the slot the
user's own layout history says it should: cmux already learns layout
transitions in the `transitions` SQLite table, and `cmux <cmd>` reuses that
learning to place the pane the way the user would have, by hand.

```
cmux pytest tests/
cmux git rebase -i HEAD~5
cmux $EDITOR src/main.ts
cmux make build
```

The shell you're typing in is untouched. You stay where you are. The pane
appears in the current window, in the position cmux has learned you prefer,
and you can glance over at it via the carousel whenever.

The feature is the vehicle. The story is **how the build happens**: forked
subagents working in parallel, coordinating by message, resuming after they
finish, and even talking across separate cmux sessions. Five capabilities,
one build.

## Capabilities exhibited

1. `/fork` — spawn a forked subagent
2. Parallel forks — multiple `/fork` calls in one message
3. SendMessage between forks — coordination by name
4. Resume a stopped subagent by @name
5. Cross-session SendMessage — one cmux popup messaging another

Capabilities 4 and 5 are the novel ones for most of the audience. Move
briskly through 1–3 and slow down for 4 and 5.

## What `cmux <cmd>` does

- Inside tmux, reads the current window's pane layout.
- Queries the `transitions` table for the most-frequent transition from this
  layout to a layout with one more pane. Falls back to the top-ranked
  same-pane-count+1 layout in `ALL_LAYOUTS` if there's no learned history.
- Applies the new layout via the existing tmux-layout / swap-orchestrator
  code paths so the new pane lands in the right slot.
- Runs the command in the new pane. Sets the pane title to the command argv
  so the layout picker and pane border show what's in there.
- Sets `remain-on-exit on` for that pane so when the command finishes the
  pane stays alive showing the output until the user closes it.
- Does not steal focus. The user's cursor stays in the pane they were in.

Outside tmux: refuse. Window already at 4 panes (the max in `ALL_LAYOUTS`):
refuse with `current window full`.

Flags: `--json` only. Prints `{paneId, command, layoutBefore, layoutAfter}`
so callers — especially the skill — know where the command landed. No
`--focus`, no `--auto-close`, no `--new`. Keep v1 tight.

## Framing (45s)

cmux is a typeahead-first tmux workspace manager. It already learns from
you: which repos you open most, which layouts you transition to from which.
`cmux <cmd>` is a tiny CLI on top of that learning. You type `cmux pytest`,
a pane appears in the spot you'd have put it, the tests run, you keep
coding.

The interesting question isn't what it does. The interesting question is
**how we build it**, live, with a fleet of forked subagents.

## Act 1 — `/fork` once (1 min)

Open a Claude Code session. Single fork to lock the CLI surface:

> /fork design the `cmux <cmd>` CLI surface — argv handling, the inside-tmux
> check, the `--json` output shape, exit codes, the failure messages. Don't
> implement the layout logic or the split call yet, just lock the contract.

Coordinator panel comes alive with one box. Narrate: *"this is what `/fork`
does — spawns a subagent that runs in the background and reports back when
it's done."* Wait for completion, read out the proposed surface.

## Act 2 — Parallel forks (2 min)

Once the surface is locked, fan out two forks **in a single message**:

> /fork implement the layout-aware pane placement: read the current window's
> layout via tmux, query the `transitions` table the same way
> `getRankedTransitions` does in `src/layout-store.ts`, pick the next
> layout, apply it via the existing tmux-layout code paths, return the new
> pane id. Match the CLI surface fork-A produced.
>
> /fork write the SKILL.md teaching Claude when to reach for `cmux <cmd>`,
> plus the pane-title escape sequence, plus `remain-on-exit on`, plus
> integration tests against fork-A's CLI surface.

Two boxes appear in the coordinator panel. Narrate: *"these are running
concurrently — independent context windows, no shared state. The point
isn't speed, it's that they don't interfere with each other or with my main
session."*

## Act 3 — SendMessage between forks (2 min)

Mid-run, the skill+tests fork hits a problem: it needs to know the exact
shape of the `--json` output to write assertions, and the implementation
fork has tweaked the field names. It SendMessages the implementation fork
**by name**:

> tests-fork → impl-fork: "your `--json` is using `pane_id`, mine expects
> `paneId`. Pick one and tell me which."

Pause the demo here. Open the coordinator panel detail view, show the
message in flight. Narrate: *"this is the part nobody sees in a normal
subagent demo — the forks are talking to each other. They share a contract,
one needed the other to settle a naming question, they handled it without
coming back to me."*

Implementation fork acks, fixes, replies. Tests fork resumes and finishes.

## Act 4 — Resume a stopped subagent (2 min)

Both forks complete. Coordinator panel shows them as done. Then change the
spec mid-flight:

> Hey, I want `cmux <cmd>` to also refuse cleanly when the current window is
> already at 4 panes — print `current window full` to stderr and exit
> non-zero.

Instead of spawning a new fork, **SendMessage the completed implementation
fork by @name**:

> @impl-fork: add the 4-pane refusal. Read the current layout, count panes,
> if it's already 4 print `current window full` to stderr and exit 2. Match
> the existing failure-message style.

The fork **resumes with full context** — it remembers the layout reading
code it just wrote, the CLI surface fork-A locked, the field names it
settled with the tests fork. Adds the new behavior in one shot.

Narrate: *"completed doesn't mean gone. The fork is still addressable,
still has its context, still knows what the build looks like. This is huge
for any flow where the spec evolves — you don't restart, you continue."*

> **Rehearsal note:** Verify this actually works on a *stopped* subagent
> before the webinar. The Agent tool docs say SendMessage by name resumes
> "previously spawned" agents with full context, which should include
> completed ones, but this needs a live test. Easy check: `/fork` something
> trivial, wait for completion, SendMessage to its name, confirm it resumes
> rather than failing.

## Act 5 — Cross-session SendMessage (2 min)

Cut to a **second cmux popup** in a different tmux window, where a separate
Claude session has been running unrelated work — say, reviewing a PR in
another repo. Two completely separate Claude Code processes, two sockets.

In the build session:

> Before I ship this, I want a second opinion on whether `cmux <cmd>` should
> default to focusing the new pane or not. Let me ask the other Claude.

Run `ListPeers`, find the other session's `uds:/tmp/cc-socks/<pid>.sock`,
SendMessage it the question. Switch to the other tmux window — the message
has arrived, wrapped in `<cross-session-message from="...">`. The other
Claude reads it, replies. Switch back. The reply is waiting.

Narrate: *"two separate Claude Code sessions, on two different problems, on
the same machine, talking to each other. No shared state, no central
server, just unix sockets and a peer list."*

Close with the anecdote: *"and this isn't a staged demo — this happened to
me yesterday in a real session. I was brainstorming this very feature, and
another cmux session running on my laptop sent me a message asking if I
was the one editing `src/main.ts`, because it was about to start a change
there and didn't want to collide. Two Claudes sorting out a merge conflict
before the conflict happened. That's the future this unlocks."*

## Total runtime

Roughly 9–10 minutes. Tighten Act 1 if you need to land closer to 8.

## Backup / failure plan

- If a fork stalls, cut to a pre-recorded VHS tape of the same build
  sequence.
- If Act 4's resume-by-name turns out not to work on stopped agents, pivot:
  resume a *paused* fork instead, or address one that's still running but
  idle. The capability story still lands.
- If the cross-session demo can't reach the other socket live, fall back to
  showing the actual message exchange from yesterday's real-session
  anecdote as scrollback.
- Keep the spec change in Act 4 (`current window full` refusal) scripted so
  the resume is deterministic.

## Open rehearsal questions

- Verify resume-by-name on a stopped subagent (Act 4).
- Decide whether the second cmux session in Act 5 is pre-warmed or spun up
  live. Pre-warmed is safer; live is more honest.
- Pick the real anecdote text for the Act 5 closer — the layoutOrder /
  cross-session message that landed in the brainstorming session, lightly
  edited for clarity.
- Confirm the coordinator panel renders SendMessage exchanges in a way the
  webinar audience can read at video compression. If not, prepare a zoomed
  inset.
