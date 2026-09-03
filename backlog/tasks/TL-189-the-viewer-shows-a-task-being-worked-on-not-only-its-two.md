---
id: TL-189
title: "The viewer shows a task being worked on, not only its two ends"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: in-flight
    bash: "node --test scripts/tests/viewer-in-flight.test.mjs"
---

## Goal

While a session is working on a task, the viewer shows that something is
happening — the session, its actor, when it was last heard from — instead of a
card that sits in `in_progress` and says nothing for two hours.

## Context

Came out of the same observation as TL-188, and it is the half that a worktree
switcher does NOT solve. A task file changes exactly twice per session: `next`
writes `status` and `owner` at the start, `done` writes `status` at the end.
Everything between those two writes is invisible in the backlog, because the
backlog records DECISIONS, not work. So a reader watching an autonomous fleet
through statuses alone sees two frames of a two-hour film — and adding live
push (TL-122) to that only makes the two frames arrive faster.

**The material already exists and is already collected.** The heartbeat log
(`branchling activity`) records per-session events; `branchling focus` says
which task a session's heartbeats belong to; `branchling sessions` and
`branchling session <id>` already narrate one session — tasks, clusters, what
moved. None of it is on the page.

**The privacy boundary is not negotiable and is already drawn.** The raw log
lives OUTSIDE every repository, in the data directory, one subdirectory per
backlog; only the per-task AGGREGATE under `activity/rollup/` is committed,
because a record of what hour somebody worked cannot be taken back out of a
public history. The viewer serves from the machine that holds the raw log, so
it MAY read it — but nothing it shows may end up in a committed file, and the
existing `activity report --privacy`, `prune` and `forget` routes stay the only
way that data is managed.

**What "shows something is happening" must mean, precisely.** Not a spinner: a
spinner is a claim with no evidence behind it. The honest signals are the last
heartbeat's timestamp, the actor, and the count of events since the take — all
of them facts the log holds. A session that stopped an hour ago must READ as
stopped, not as busy; that distinction is the whole value, because it is also
how a dead session is spotted (see TL-151).

## Pre-flight reading

1. `branchling activity --help` and the module behind it — what a heartbeat
   record holds, and where the raw log lives.
2. `scripts/build-viewer.mjs` — where a card is rendered, and what data it
   already has.
3. `scripts/serve-backlog.mjs` — the SSE push already used for local edits;
   this rides on it rather than opening a second channel.
4. `docs/backlog-time-tracking.md` — the rule that separates a completion
   timestamp from work time, and why it exists.

## Steps

1. A read route for the live signal: per task, the last heartbeat, its actor,
   and the event count since the take.
2. Render it on the card and in the detail panel, with an explicit "last heard
   from N minutes ago" rather than a busy indicator.
3. Push it over the existing SSE channel.
4. `scripts/tests/viewer-in-flight.test.mjs` over a fixture log: a fresh
   heartbeat reads as working, an hour-old one does not, and an absent log
   renders the card exactly as today.

## Decisions

Nothing decided. Open: whether the same route feeds TL-91's replay, which folds
the SAME log over time — if it does, it should be written once.
