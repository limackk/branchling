---
id: TL-180
title: "history in a fresh worktree signs its whole tree as created by you"
type: task
labels: []
board: main
epic: "History and attribution"
priority: P2
status: done
owner: agent:dev
role: dev
executor: ""
estimate: 2h
confidence: medium
created: 2026-09-03
updated: 2026-09-03
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: the-seed
    bash: "node --test scripts/tests/history-manual.test.mjs"
---

## Goal

`worktrail history --actor <ns:name>` run in a tree whose snapshot has never
seen the tasks stops claiming their authorship. A first pass over an unknown
tree is a SEED, and the entries it writes must not say a name that did not
create them.

## Context

Observed 2026-09-03 in this worktree while working
[TL-169](TL-169-the-name-worktrail-is-already-a-github-organisation-the.md),
with real damage: the command appended `__created__` records for TL-173 and
TL-177 — two tasks created the day before by a different session in the main
checkout — under `actor: agent:claude`, `source: manual`. The log is
append-only, so the false attribution would have been permanent had the files
been committed; it was caught only because `check --history` failed for an
unrelated reason (the logs were untracked) and the entries were compared
against the main checkout's copies, which correctly say `unknown` / `external`.

**A worktree starts with no snapshot.** `history/.snapshot.json` is a computed
file, so a newly created worktree has none, while `tasks/` arrives complete from
the branch. The diff is therefore "every task in this tree is new", and the
actor on the command line gets written across all of it. Nothing about the
invocation is wrong — this is the path
`worktrail instructions task-execution` actively recommends after a hand edit
("You edited by hand → `worktrail history --actor <ns:name> --source manual`"),
so the trap is on the well-lit route, not on a strange one.

**The seed behaviour already exists and is not reached here.** The suite has
"the first pass SEEDS — zero entries, despite 2 existing tasks", so a genuinely
first pass is meant to record nothing. What has to be established is why this
tree took the other branch: whether the snapshot was present but stale (written
by a `build` before the tasks arrived), or absent and the seed condition is
tested only against an empty `tasks/` directory. That is the first step, and it
decides whether this is a bug in the seed condition or a missing case beside it.

**Why `--file` is not the answer.** Scoping the command to one file avoids the
damage and is what a careful caller does, but the flag is optional and the
unscoped form is the one the instructions print. A safeguard that depends on
remembering a flag is not a safeguard.

## Pre-flight reading

1. `scripts/history.mjs` (or wherever the snapshot diff lives) — how the seed condition is decided, and against what.
2. `scripts/tests/history-manual.test.mjs` — the existing seed test; the sample it establishes is where the gap will be visible.
3. `backlog/history/TL-173.jsonl` and the same file in the main checkout — the two versions of one event, which is the evidence.
4. `CLAUDE.md`, "Session state (locks) lives OUTSIDE the repository" — the same class of defect: a computed file that is per-worktree while the data is per-branch.

## Steps

1. Reproduce: create a worktree from a branch that has tasks, run `worktrail history --actor test:x --source manual` in it without `--file`, and read what lands in the logs.
2. Establish which condition failed — snapshot absent, or snapshot present and behind — because the fix differs.
3. Fix so that tasks the snapshot has never seen are SEEDED, never attributed. A task the snapshot has seen and that then changed is a real change and keeps its author.
4. Decide what the command SAYS in that case. Silence would be indistinguishable from "nothing to record"; the count of seeded tasks belongs in the output.
5. Add the regression test to `scripts/tests/history-manual.test.mjs` with a positive control, so it cannot pass on a zero sample.

## Acceptance criteria

- [x] A first pass in a tree whose snapshot has never seen the tasks writes no `__created__` entry naming the caller. [proof: the-seed]
- [ ] A change to a task the snapshot DOES know is still recorded under the caller — the fix does not buy safety by recording nothing.
- [ ] The command's output distinguishes "seeded N tasks" from "nothing to record".
- [ ] The regression test establishes its own fixture and fails against the current code.

## Decisions

- **The two entries already written were replaced, not appended to.** They were
  minutes old, untracked, contradicted by the authoritative copies in the main
  checkout, and false. Restoring the true record is not a rewrite of the log's
  history; publishing an invented author would have been the unrecoverable act.
  This is the only such correction, and it is recorded here so it is not read as
  a precedent for editing `history/`.
