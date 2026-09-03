---
id: TL-189
title: "The viewer shows a task being worked on, not only its two ends"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
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

**The signal is a ROUTE, never a variable in the page.** `buildHtml` also writes
`backlog/viewer.html`, which is mailed around and opened over `file://`. Baking
the log's answer into that file would carry a record of what hour a named person
worked out of the machine that holds it — the exact failure that keeping the raw
log outside every repository exists to make impossible. So the page starts with
an empty map and fills it from `/api/in-flight`; over `file://` it stays empty
and no card claims anything, which is the honest state: there is nobody to ask.
A test asserts a build made while fresh rows exist carries no session id, no
actor and no heartbeat timestamp.

**"Stopped" is `idle_gap_minutes`, not a threshold of this feature's own.** The
project has already declared how long a gap ends a working session — that is the
key `cluster.mjs` splits runs on. A second number here would let the page call an
interval "being worked on" that the same project's own minutes report had already
cut in two, with nothing to say which was right. The boundary is `<=`, decided
the way rule 2 in `cluster.mjs` decides it.

**The window is the LAST take**, read from `history/` and from the status
`in_progress_status` names. A task picked up, dropped and picked up again has two
stints; one window over both would credit this session with the previous person's
rows, and a task taken a minute ago whose only heartbeats are a week old must
read as "nothing heard yet" rather than as a week-old session.

**Shown on an in-progress task always, elsewhere only while live.** The badge on
a task that has been quiet for three hours IS how a dead session is spotted
(TL-151), so hiding it would restore the two-frame film. Heartbeats arriving on a
task somebody has already closed are the honest anomaly and are always shown. A
task closed last week whose log still holds the rows that measured it shows
nothing — that is history, `Measured` already reports it, and a badge on every
card the log ever saw is no badge.

**The age advances on a clock, not on an event.** Silence is the one signal that
sends nothing, so a repaint on a timer — with no fetch behind it — is what turns
a card from "1m" into "65 minutes ago". Without it the card would sit at one
minute forever, which is the spinner again, wearing a number.

**Answered: the route does NOT feed TL-91's replay.** This is a fold to ONE
instant; a fold over a series is not that function with a parameter added.
Sharing it would mean either recomputing every task's whole history on every SSE
tick, or caching a series whose whole value is that it is not cached. If replay
wants the rows it reads them itself — `readAllActivity` is the shared piece, and
it already exists.
