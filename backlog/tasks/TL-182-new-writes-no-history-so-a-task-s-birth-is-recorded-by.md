---
id: TL-182
title: "new writes no history, so a task's birth is recorded by whoever reconciles first"
type: task
labels: []
board: main
epic: "History and attribution"
priority: P2
status: done
owner: unassigned
role: ""
executor: ""
estimate: 2h
confidence: high
created: 2026-09-03
updated: 2026-09-03
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: new-records-itself
    bash: "node --test scripts/tests/new-task.test.mjs scripts/tests/history.test.mjs"
---

## Goal

`branchling new` records the task it just created, under the actor that ran it,
the way every other writing command records what it did. A task's `__created__`
entry stops depending on which working tree happens to reconcile first.

## Context

Measured 2026-09-03 in a scratch repository, not inferred: `init` followed by
three `new` calls produces **four task files and zero history logs**. Nothing is
written until some later reconcile — a `build`, a `check`, a running `serve` —
notices a task the snapshot does not know.

**`new` is the odd one out among the writing commands.** `take` records with
`source: take`, `done` records its closing. `new` creates a file and says
nothing, so the one fact only it knows — who created this task, and when — is
left for something else to infer later.

**What the inference produces is worse than nothing, because it looks fine.**
The reconcile cannot know who created the task, so it writes `actor: unknown`,
`source: external`. That value is correct and reserved for exactly this — a
change observed rather than made — but here it is not an unavoidable gap: the
information existed, in the process that had just been told the title, and was
discarded.

**It bit this repository twice in one session, in two different ways.**
TL-173 and TL-177 were created in the main checkout and their logs never
committed, so `check --history` failed on a branch that had the tasks and not
their history. Then TL-181 was created in a worktree, committed with no log at
all, and its `__created__` was written by the main checkout's reconcile after
the merge — a second commit to fix what one command should have written.

**Related but not the same defect.**
[TL-180](TL-180-history-in-a-fresh-worktree-signs-its-whole-tree-as-created.md)
is the other face of this: a `history` pass over a tree whose snapshot is behind
signs every unknown task as the caller. Both come from the snapshot being
per-tree while `tasks/` is per-branch — but the fixes differ, and TL-180 must
not be made to depend on this one.

## Pre-flight reading

1. `scripts/new-task.mjs` — what `new` writes today, and where a history append would go.
2. `scripts/take-task.mjs` (or wherever `take` records) — the shape a writing command's entry takes, including `source:`.
3. `scripts/history.mjs` — the reconcile, and the snapshot it diffs against, which is what has to be updated in the same act.
4. `backlog/tasks/TL-180-history-in-a-fresh-worktree-signs-its-whole-tree-as-created.md` — the sibling defect, so the two fixes do not collide.

## Steps

1. Reproduce in a scratch backlog: `init`, then `new` three times, and count the logs. That is the failing case and the regression test.
2. Make `new` append its own `__created__` entry with the actor that ran it and a `source` naming the command, and update the snapshot in the same act so a later reconcile does not record it a second time.
3. Decide what `new` does when no actor is given — it takes no `--actor` today, while `take` and `done` do. That is a decision, not an oversight to paper over.
4. Check the other writing commands for the same gap rather than assuming `new` is alone.
5. Regression test with a positive control: the log exists, names the caller, and a following `build` appends nothing.

## Acceptance criteria

- [x] `new` leaves a `__created__` entry naming the actor that ran it. [proof: new-records-itself]
- [ ] A `build` straight after `new` appends nothing — the entry is not written twice.
- [ ] The behaviour when no actor is supplied is decided and recorded, not defaulted silently.
- [ ] Any other writing command with the same gap is either fixed here or has its own task.

## Decisions

- **`unknown` stays reserved and is not the thing being fixed.** It is the right
  value for a change nobody claimed. The defect is that a change somebody DID
  make reaches the log as if nobody had.
