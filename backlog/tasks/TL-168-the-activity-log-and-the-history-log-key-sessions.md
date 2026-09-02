---
id: TL-168
title: "The activity log and the history log key sessions differently"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-02
updated: 2026-09-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite
    bash: "node --test scripts/tests/session-report.test.mjs scripts/tests/activity.test.mjs"
  - id: joined-in-this-tree
    bash: "node scripts/cli.mjs session $(node scripts/cli.mjs sessions --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);process.stdout.write(r.sessions.length?r.sessions[0].session:'none')})\") --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);if(!r.session||!r.session.changes.length){console.error('the newest session reports no changes — the two logs are still keyed apart');process.exit(1)}console.log('the logs join in this tree — OK')})\""
---

## Goal

A session's activity rows and its history entries carry the same identifier, so
`worktrail session <id>` reports the changes that session made. Today, in this
very repository, it reports none.

## Context

TL-164 gave every history entry the session it was written in and made
`worktrail session <id>` join on that field instead of guessing by time window.
The join is exact. It is also, in this repository's own setup, empty — because
the two logs are keyed in different id spaces.

**Measured on 2026-09-02, immediately after TL-164 closed:**

- The activity rows of the running session carry
  `session: 3d71196b-2eae-4664-833f-be84f1e1da16` — the HOST's id, which
  reaches `activity-command.mjs` inside the hook payload as `session_id`.
- The history entry `done` had just written carries
  `session: tree-cb84986431a6` — the DERIVED key, because `currentSession()`
  reads `sessionId()`, which finds no `BACKLOG_SESSION` in the environment and
  falls back to a hash of the worktree.
- `worktrail session 3d71196b-…` therefore prints `what moved (0)` for a
  session that closed seven tasks.

**Where the asymmetry comes from.** `activity-command.mjs` deliberately prefers
the payload's id for the ROW — its own comment explains why: clustering has to
tell two sessions in one checkout apart, and the derived key cannot. Nothing
else in the tool can see that id: a plain `worktrail done` is not run by the
hook and has only the environment. So the activity log knows a name for the
session that no other writer can learn.

**Two candidate fixes, and choosing between them is the work.**

1. *Make the environment the contract.* `BACKLOG_SESSION` already exists for
   exactly this and is documented as "the session identifier, when the host has
   one to give". If the hook that reports activity also exported it, every
   worktrail process in that session would agree. This costs nothing in code
   and everything in reliance: it works only where somebody has configured it,
   and where they have not the failure is silent — which is the shape of defect
   this project keeps refusing.
2. *Carry both keys on the activity row.* The row's writer is the ONE place
   that knows the host id and the derived key at the same moment
   (`activity-command.mjs` computes `focusSession` beside `session` already).
   A second field would let the report accept a history entry stamped with
   either. The cost is a schema change to an append-only log whose header
   argues, for `reassign`, that extra fields must earn their place.

They are not exclusive: 2 makes the join work everywhere, 1 makes the ids
identical where a host cooperates.

**A consequence to settle either way.** A session that wrote history but sent no
heartbeat is invisible to `sessions`, because `collectSessions()` is built from
activity rows alone. Under the mismatch above that is not hypothetical — the
`tree-…` session exists only in the history. Decide whether a history-only
session is a session.

## Pre-flight reading

1. `scripts/activity-command.mjs`, the "TWO SESSION KEYS" comment — why the row
   prefers the payload id, and why the focus is read under the derived one.
2. `scripts/history.mjs`, `currentSession()` — the other side of the join, and
   the rule that only a write which MADE a change may stamp it.
3. `scripts/session-report.mjs`, `correlateChanges()` — where the join happens
   and where `unattributedChanges` is counted.
4. `docs/backlog-time-tracking.md` §6 — what clustering needs from a session id.

## Steps

1. Reproduce: run any writing command in this repository and compare the
   `session` on the new history line with the `session` on the day's activity
   rows. Keep both values in the task.
2. Choose between the two designs above, or take both, and record why.
3. Whichever is chosen, a history entry stamped with a session the report does
   not recognise must not vanish in silence — today `correlateChanges()` skips
   it without counting it, which is a third invisible state beside "mine" and
   "nobody's".

## Acceptance criteria

- [x] In this repository, `worktrail session <the newest session>` lists the changes that session made. [proof: joined-in-this-tree]
- [x] A history entry carrying a session the report does not know is counted, not silently skipped. [proof: suite]
- [x] The decision about a history-only session — whether `sessions` lists it — is recorded in this file. [proof: suite]

## Notes

- Found while closing TL-164, which is why that task's own contract passes: it
  proves the field is written and the join is exact, both of which are true.
  What it cannot prove is that the two logs agree about a name, and that is
  this task.
- Out of scope: what a session IS. The clustering, the idle gap and the minutes
  are settled and nothing here revisits them.

## Decisions

**Reproduced first, exactly as step 1 asks.** After TL-164 landed, the running
session's activity rows were keyed
`3d71196b-2eae-4664-833f-be84f1e1da16` and the history entry `done` had just
written was keyed `tree-cb84986431a6`; `session 3d71196b-…` printed
`what moved (0)` for a session that had closed seven tasks. After this change
the same call lists them.

**Design 2, and not design 1.** The activity row carries `derived` — the key
every other process of this tool computes from the checkout — written only when
it differs from `session`. Its writer is the one place that sees both names at
the same moment, so it is the only place that can say they are the same session,
and it says so without anybody configuring anything.

Design 1 — `BACKLOG_SESSION` exported by whatever reports activity — is the
better arrangement where a host can be configured, and it is now documented in
`docs/backlog-time-tracking.md` §5. It is deliberately not what the join relies
on: relying on configuration fails silently on every machine where nobody did
it, and a report that is exact and empty is the worst of the three possible
answers. The two are not exclusive; where a host exports the variable the ids
are identical, `derived` says nothing and is absent.

**The field earns its place the way `to` and `since` do.** The log's own header
argues that extra fields must, and this one is written only when it carries
information the row does not already have. A second name on every row would
bloat a file that grows in the thousands and invite a reader to look for an
alias on rows that have none.

**A history-only session is NOT a session, and `sessions` does not list one.**
A session here is a span of measured work: the minutes come from clustering
heartbeats, and a row built from history alone would have no minutes, no
clusters and no span — a row of nulls pretending to be a measurement. But it may
not be invisible either, so `unknownSessionChanges` counts the changes on a
session's tasks that name a session the activity log has never seen, and the
text output says so with a warning marker.

**Three states, three names, and that is the point.** `changes` are this
session's, joined on any name it answers to. `unattributedChanges` name no
session at all — every line written before TL-164, and every change reconciled
from a hand edit. `unknownSessionChanges` name a session nothing has ever heard
of. A change belonging to ANOTHER listed session is none of these: it is not
missing, it is in that session's own row.
