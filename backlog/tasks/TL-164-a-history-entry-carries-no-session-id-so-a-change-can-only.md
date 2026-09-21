---
id: TL-164
title: "A history entry carries no session id, so a change can only be guessed at"
type: bug
labels: []
board: main
epic: "History and attribution"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
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
[TL-92](TL-92-worktrail-session-report-from-an-agent-s-session.md). That task's own context
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

- [x] A history entry written by a command carries the session it was written in. [proof: suite]
- [x] An entry with no session id still reads, and is not reported as belonging to one. [proof: suite]
- [x] Two sessions changing one task at overlapping times are told apart. [proof: suite]
- [x] `worktrail session` no longer needs to say its answer is a window guess. [proof: carried]

## Notes

Out of scope: changing what an actor means, or the attribution chain. This adds
one field to an existing record; it does not revisit who anybody is.

## Decisions

**Where a command learns its session id: from `sessionId()` in `focus.mjs`, the
same function the activity log already uses.** That is not convenience, it is
the requirement. `worktrail session <id>` joins the two logs on this value, and
a second derivation of "which session is this" would disagree with the first in
exactly the cases the report exists for. `history.mjs` exposes it as
`currentSession()` so no caller reaches past it into the focus module.

**Only a write that MADE the change may stamp it.** `reconcile()` records
changes it merely SAW — an editor, git, another session — and stamping the
observing process there would attribute somebody else's work to whoever happened
to run the reconcile. That is TL-130's defect arriving through a new field, and
it is the one rule this whole feature turns on. `recordEdit` and the seven
commands that build entries by hand stamp; reconciliation does not.

**The field is ABSENT when there is none, never `""`.** An empty string would be
a third state beside "absent" and "present" that means the same as the first,
and every reader would have to know that to count correctly. `appendEntries`
strips a falsy `session` in one place, so no caller can produce the third state
by accident.

Note the asymmetry with `reason`, which IS on every row: a reason is something a
writer either gave or withheld, and both are facts about the same write. A
session is something a write either has or genuinely has not.

**The window fallback is dropped, not kept alongside.** Step 3 offered keeping
it for old entries and labelling each row with the join that produced it. Both
were rejected: correlating by time is precisely the guess this task removes, and
a list mixing exact rows with guessed ones is harder to read than the honest one
— every reader would have to check each row's provenance before believing it.

**But the old changes are not dropped in silence.** `unattributedChanges` counts
the changes on a session's tasks that fall inside its window and carry no
session id. They are real changes belonging to nobody, and a count is the only
true thing that can be said about them. Without it, an empty list would read as
"nothing happened".

**`correlation` stays in the JSON envelope**, now reading `session` rather than
`window`. It could have been dropped as a constant; it is not, because a
consumer reading an older log through a newer tool needs to be able to see which
join it got.

**A gap this task does NOT close, measured rather than assumed: TL-168.** The
join is exact, and in this repository it is also empty. `activity-command.mjs`
prefers the HOST's session id — which reaches it inside the hook payload — for
the row it writes, while a plain `worktrail done` can only see
`BACKLOG_SESSION` in its environment and falls back to a hash of the worktree.
So the activity rows here are keyed `3d71196b-…` and the history entries
`tree-cb84986431a6`, and `session <id>` reports no changes for a session that
closed seven tasks. That is not a defect in the field or in the join; it is the
activity log knowing a name for the session that no other writer can learn, and
it needs its own decision — the environment as a contract, or both keys on the
row. Recorded in full in TL-168 rather than guessed at here.
