---
id: TL-164
title: "A history entry carries no session id, so a change can only be guessed at"
type: bug
labels: []
board: main
epic: "History and attribution"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 4h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: suite
    bash: "node --test scripts/tests/session-report.test.mjs"
  - id: carried
    bash: "node scripts/cli.mjs session --help | grep -q 'correlated by' && exit 1; echo 'the session report no longer needs the window caveat — OK'"
---

## Goal

A history entry records the session it was written in, so `worktrail session
<id>` can say which changes a session made instead of inferring it from a time
window.

## Context

Found on 2026-09-02 while building
[TL-92](TL-92-tasklog-session-raport-z-sesji-agenta.md). That task's own context
anticipated this exactly: *"correlating with a session requires the hook to also
record a session identifier on a field change — if TL-28 did not provide for
that, report it there, do not work around it here."* TL-28 did not, so this is
the report.

A history entry today carries `id`, `ts`, `task`, `field`, `from`, `to`,
`actor`, `source`, `reason`. The activity log's heartbeat carries `session`. The
two cannot be joined on anything but time.

**What TL-92 does in the meantime, and why it is not a fix.** It correlates by
TASK and TIME WINDOW, and says so on every answer (`correlation: "window"` in
`--json`, a sentence in the text output). The consequence is real and visible: a
change another actor made to the same task while a session happened to be
running is listed under that session, with its own actor beside it. That is an
approximation labelled as one, not a mechanism.

**Why this is worth closing.** The whole value of a session report is "what did
this agent deliver" — and with a window join, two agents working the same task
at the same time cannot be told apart at all. That is precisely the case a fleet
of parallel worktrees produces.

## Pre-flight reading

1. `scripts/history.mjs` — the entry shape and `appendEntries`; where a field
   would be added, and how an entry missing it must still read.
2. `scripts/session-report.mjs` — `correlateChanges()` and the caveat it prints;
   both go away when the field arrives.
3. `docs/backlog-field-editing-history.md` §2 — the entry format as documented,
   which has to move with the code.
4. `scripts/activity.mjs` — where the session id comes from today.

## Steps

1. Decide where a writing command LEARNS its session id. The activity side
   already has one; whether the history writers can reach the same value, or
   whether it has to be passed in, is the first question and the answer belongs
   in this task.
2. Add the field. An entry WITHOUT it must keep reading — the log is
   append-only and every existing line has none.
3. `session-report.mjs` joins on the id, and drops the window fallback along
   with its caveat. Or keeps the fallback for old entries and says which join
   produced each row; decide and record which.
4. Update the entry format in `docs/backlog-field-editing-history.md` §2.
5. Test: two sessions changing the SAME task at overlapping times are reported
   separately, which is the case a window join cannot get right.

## Acceptance criteria

- [ ] A history entry written by a command carries the session it was written in. [proof: suite]
- [ ] An entry with no session id still reads, and is not reported as belonging to one. [proof: suite]
- [ ] Two sessions changing one task at overlapping times are told apart. [proof: suite]
- [ ] `worktrail session` no longer needs to say its answer is a window guess. [proof: carried]

## Notes

Out of scope: changing what an actor means, or the attribution chain. This adds
one field to an existing record; it does not revisit who anybody is.
