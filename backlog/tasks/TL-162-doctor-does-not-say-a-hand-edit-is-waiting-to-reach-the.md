---
id: TL-162
title: "doctor does not say a hand edit is waiting to reach the history"
type: bug
labels: []
board: main
epic: "History and attribution"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: suite
    bash: "node --test scripts/tests/unrecorded-drift.test.mjs"
  - id: row
    bash: "node scripts/cli.mjs doctor --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);if(!r.checks.find(c=>c.id==='unrecorded'))process.exit(1);console.log('doctor names the gap — OK')})\""
---

## Goal

`worktrail doctor` says when a task file on disk has changed in ways the history
log has never seen — so that nobody has to remember `worktrail history` to find
out.

## Context

TL-84 decided that editing a task file by hand is a SUPPORTED path, and wrote
that decision into the README and the instruction source. That decision has one
loose end, and it was measured on 2026-09-02 rather than assumed:

- `worktrail build` does **not** reconcile. Neither does `query`, `stats` or
  `check`.
- `worktrail history --actor <ns:name> --source manual` does, and records the
  change with `reason: unknown`.
- So between a hand edit and somebody remembering that command, the change is
  **invisible on the history axis**, and nothing anywhere says so.

`doctor` already carries the rows that need no reminding — `vocabulary vs tree`
catches a hand-written value outside the vocabulary, `log vs status field`
catches a stale `## Log`. This is the same shape of question and the one row
that is missing: *is there a change on disk that the log has not recorded?*

**Why a row and not automatic reconciliation.** Reconciling inside `doctor`
would make a DIAGNOSIS write to the log, and `doctor` fixes nothing by design —
its own header says so. It would also attribute the change to whoever happened
to run `doctor`, which is the defect
[TL-130](TL-130-the-server-s-reconcile-signs-someone-else-s-changes-as.md)
already describes on the server's side. The row reports; the person decides who
signs it.

**The measurement to reuse.** `history.mjs` holds the snapshot
(`.snapshot.json`) and the diff that `history --source manual` runs. The row has
to ask that same question WITHOUT writing — check whether the reconcile can be
run in a dry mode, and if it cannot, that is the first step.

## Pre-flight reading

1. `scripts/history.mjs` — `loadSnapshot`, `reconcile`; whether the diff can be
   computed without appending.
2. `scripts/doctor.mjs` — `checkLogStatus` is the closest row in shape: it
   imports a pure audit from the guard rather than repeating it.
3. `scripts/history-record.mjs` — what `history --source manual` prints today.
4. `README.md`, "Editing a task by hand" — the decision this closes the loose
   end of, and the table of what a hand edit costs.

## Steps

1. A read-only diff: tree versus snapshot, returning the changes without
   appending a single line.
2. A `unrecorded` row in `doctor` — a WARNING, not an error: an unrecorded
   change is a normal state between an edit and the command that records it,
   and an error would make `doctor` red for as long as somebody is working.
3. The row names the command that resolves it, with the actor placeholder.
4. Test with a positive control: a tree with no edits gives an `ok` row, and
   the SAME tree with one field changed by hand gives the warning.

## Acceptance criteria

- [x] `doctor` carries a row saying how many changes the history has not seen. [proof: row]
- [x] The row is computed WITHOUT writing to the log. [proof: suite]
- [x] It warns and does not fail. [proof: suite]
- [x] The test has a positive control: an untouched tree and an edited one differ. [proof: suite]

## Notes

Out of scope: changing who a reconciled entry is attributed to — that is
TL-130. Out of scope too: making `build` reconcile, which would put a write
inside a command whose whole point is that its output is disposable.

## Decisions

**`reconcile` grew a `dryRun` rather than `doctor` growing a second diff.**
The question the row asks is exactly the one `history --source manual` answers;
a private copy of it in `doctor` would be a second implementation of the
comparison, and the one that drifted would be the diagnostic — the place a
reader trusts precisely because they are not checking it. `dryRun` skips both
writes: the log AND the snapshot. Skipping only the log would be worse than
useless, because moving the reference point forward is what makes a change
invisible to the person who is about to claim it.

**The row is a WARNING, and there is no state in which it is an error.** An
unrecorded change is the normal condition between an edit and the command that
records it. A row that went red while somebody was working would be red most of
the time, and a red that means nothing is trained out of a reader — which would
cost more than this row is worth.

**A tree with no reference point reports `info`, not zero.** "No changes the
history has not seen" and "nothing has ever been compared" are different facts,
and a fresh backlog is in the second state. Reporting the first would be the
same class of answer this task exists to remove.

**The fix string keeps `<ns:name>` as a placeholder.** The actor is the one part
the tool must not fill in: the whole reason `doctor` does not reconcile is that
it would sign somebody else's edit with whoever ran it (TL-130).
