---
id: TL-147
title: "A closed task's proof is re-run against the current tree, and a broken one is named"
type: task
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 1d                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: ["docs/branchling-state-and-sync.md"]
verification:                      # HOW to check that the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

`worktrail check --proofs [--since <sha>]` re-runs the `verification:`
contract of every task closed with a `proven` reason against the CURRENT
tree, and reports each one that no longer passes by task id, closing actor
and the commit range in which it broke.

Today `done` proves a task once, against the tree of that moment, and the
`proven` entry in the history describes the past. The tree keeps moving and
nothing asks whether the proof still stands. A regression therefore surfaces
as "test X is red", with no thesis, no context and no author beside it. After
this task it surfaces as "TL-73's proof stopped holding after abc" — and
TL-73's file already carries what the reader needs: why it was done, what it
decided, who closed it and under which run.

This is the sentence that extends the launch thesis by one clause: a `done`
that refuses becomes a `done` that STAYS proven. No competitor can do it,
because none of them stores a runnable contract in the task or knows which
closings were proven at all.

## Context

**Reuse the closing run, do not write a second one.** `done --dry-run`
already executes a task's contract and reports per entry; `--proofs` is that
loop over the archive. Two implementations of "run a contract" would diverge
on exactly the question this guard exists to answer.

**Which tasks qualify:** only closings whose history carries the reserved
`proven` reason. A task closed by a hand edit (`unknown`) was never proven
and must not be reported as "proof broken" — it is TL-90's finding, not this
one's. The two guards must not overlap in what they claim.

**`manual:` entries cannot be re-run.** Report them as "vouched, not
re-runnable" and do not count them as broken. Skipping them silently would
make a task with only manual proof look permanently green.

**No new state (law 2).** The result is computed from the archive and the
history at read time. If a durable record of a broken proof is wanted, it is
an event with `source: proofs` on that task's history — a comment naming the
range — never a field in the task file, and never a status change, because a
broken proof is a finding for a person, not a reopening.

**Cost bound.** Contracts run test suites; the archive is large. `--since
<sha>` limits the set to tasks whose `modified_files` (TL-75) or whose
verification commands touch paths changed in that range. Without TL-75 the
first version may run everything and say how long it took; do not fake a
narrowing.

**Positive control.** A fixture repository with one proven task whose
contract is then broken on purpose MUST be reported; the same fixture with
the contract intact MUST report nothing. A guard that passes on an archive
where nothing could break is green with no evidentiary force.

## Steps

1. Extract the contract runner from `done` into a function `done` and
   `--proofs` both call.
2. Select qualifying tasks from the archive by the `proven` reason in
   history.
3. Run, collect, and report: id, closing actor, closing timestamp, the
   failing entry, and the commit range since closing.
4. `--json` under the envelope, `exit 1` when any proof is broken.
5. Fixture with the positive control.

## Acceptance criteria

- [x] A proven task whose contract now fails is reported with its id, actor and range. [proof: suite-green]
- [x] A task closed with `unknown` is not reported as a broken proof. [proof: suite-green]
- [x] A `manual:` entry is reported as vouched, not as broken. [proof: suite-green]
- [x] Positive control: the intact fixture reports nothing, the broken one reports. [proof: suite-green]
- [x] `done` and `--proofs` share one contract runner. [proof: guards-green]
- [x] `--json` answers in the envelope and the exit code is non-zero on a broken proof. [proof: suite-green]
