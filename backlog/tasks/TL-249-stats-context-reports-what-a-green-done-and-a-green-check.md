---
id: TL-249
title: "stats --context reports what a green done and a green check cost a session"
type: task
labels: []
board: main
epic: "Harness"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: green-cost-rows
    bash: "node --test scripts/tests/context-budget-green-cost.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"

---

## Goal

`branchling stats --context` prints what a GREEN `done` and a GREEN `check`
cost the session that ran them, in tokens, beside the rows it already measures.
A harness is as good as the signal it hands back: a passing gate that prints a
transcript is paid for by every session that closes a task, and nothing today
makes that number visible — so nothing keeps it from growing.

## Context

Surfaced on 2026-09-04 while reviewing this repository as an agent harness. The
feedback loop is the strongest part of the tool (`done` RUNS the contract), and
its cost on success is the weakest: TL-221 measured 1698 lines of `✔` before
the two lines a closer needs, and TL-236 counts roughly 130 report lines in a
bare `check` before anything a session changed. Both are being fixed. Neither
fix survives on its own: the next guard added to `check` and the next
verification entry that prints on success will grow the number again, and the
only defence that lasts is a measurement somebody reads.

`scripts/context-budget.mjs` is the place: `contextBudget()` measures each row
by RUNNING the command over this tree, and `CONTEXT_RULE` is the standard.
`done` is a writing command, so it cannot be run there — the comment above the
`count` row says why `next` is absent for the same reason. The cost of a green
`done` has to be measured without closing anything: `done --dry-run` on a closed
task, or a capture of the contract run over an already-`done` task's entries,
whichever `scripts/done-task.mjs` can offer without a write. If neither can be
made side-effect free, the row is NOT added and the report says so — a
diagnostic that writes is the defect the comment warns about.

`check` reads only; its full output over this tree is the row.

Rejected: putting the numbers in `doctor`. `doctor` says whether the backlog is
set up; `stats --context` is where the cost of every other answer already lives,
and a second table would be a second place to compare.

## Pre-flight reading

1. `scripts/context-budget.mjs` — `contextBudget()`, the `add()` rows, and the
   comment explaining why `next` is not measured
2. `scripts/done-task.mjs` — `runBash()` with `capture`, and `--dry-run`, to
   find a path that measures without writing
3. `scripts/tests/context-budget.test.mjs` (or the nearest test over
   `stats --context`) — the fixture shape to extend
4. `backlog/tasks/TL-221-*.md`, `backlog/tasks/TL-236-*.md` — the two fixes
   whose effect this row is meant to keep

## Steps

1. Add a `check` row: the length of `check`'s full output over the tree, with a
   note saying it is what a session pays to learn the guards are green.
2. Add a `done` row measured side-effect free, or record in Decisions that it
   cannot be and why, and leave it out.
3. Order both rows by cost like the others; the `listOverBudget` judgement is
   untouched.
4. The test: a fixture tree with one task whose contract prints N lines on
   success; the row reports a token count that tracks N. A tree where the
   contract prints nothing is the negative case, not the only case.

## Acceptance criteria

- [x] `stats --context` prints a `check` row whose tokens are the measured
      length of `check`'s output over this tree. [proof: green-cost-rows]
- [x] A `done` row is printed and measured without any write to the backlog, or
      Decisions records why it is absent. [proof: green-cost-rows]
- [x] `stats --context --json` carries the new row(s) in `rows`.
      [proof: green-cost-rows]

## Decisions

Nothing decided.
