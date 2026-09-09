---
id: TL-240
title: "A wave branch makes suite-green unsatisfiable for every task but the last"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: cancelled  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: the-refusal-names-the-owner
    manual: "Put two tasks of one wave on one branch, commit the failing spec test of the second, finish the first, and run `done` on the first. Its refusal has to distinguish the failures its own contract is responsible for from the ones the sibling's spec hand planted."
---

## Goal

A dev hand that has finished its task can tell, from the refusal alone, whether
the red suite is its own work or a sibling's unimplemented spec — and a task
whose own proof is green is not held open by a task nobody has started.

## Context

MEASURED ON 2026-09-04, on the branch `tl-202-wave7-pipeline`. The two-hand
pipeline runs a whole wave on ONE branch: a spec hand writes a failing test and
hands the task on, then a dev hand makes it pass. Wave 7 put TL-202 and TL-201
on that branch, in that order.

WHAT HAPPENED. TL-201's spec hand committed `4db2bc6`, which adds three
deliberately failing assertions to `scripts/tests/public-language.test.mjs` and
hands TL-201 to a dev hand. TL-202's dev hand then finished TL-202 in `2ca784d`.
Both of TL-202's own proofs are green — `check` exits 0, and
`scripts/tests/shared-state-boundary.test.mjs` passes in full. `done` refused
anyway, because TL-202's contract also carries `suite-green`, and the suite is
red on TL-201's three tests. TL-201 is a one-day migration (replace the language
guard's signal list with a spellchecker and a project dictionary) and was still
`pending`, held by nobody.

WHY THIS IS NOT ONE BRANCH'S BAD LUCK. Every task in this repository carries
`suite-green` in its `verification:`, and the pipeline is designed to put a
FAILING test in the tree before the code that answers it. Those two facts
compose into a rule: on a shared branch, the Nth task of a wave cannot close
until the (N+1)th has been implemented, whatever order the loop dispatches them
in. The last dev hand of a wave pays nothing; every other one is refused for
somebody else's work.

WHY THE REFUSAL IS HARD TO READ. `done` prints every criterion it ran. On this
tree that is roughly 1800 lines of ticks with three crosses at the end, and
nothing in the output attributes a failing test file to the task that owns it.
The hand reading it cannot tell "you broke the tree" from "you are standing
behind somebody else's spec commit" without going to `git log` for each failure.

WHAT IS NOT THE ANSWER. Weakening `suite-green` to the task's own test file:
a task that breaks a neighbouring module would then close green, which is the
whole reason the criterion is there. Nor is "wait and re-run `done` later" —
that is what happens today, and it costs a dispatch, a full suite run and a
session that ends with nothing committed.

CANDIDATE DIRECTIONS, none of them chosen here. One branch per task, with the
wave being an ordering rather than a shared tree. Or `done` attributing each
failing test file to the task whose commit introduced it, and saying so in the
refusal — the data is in `git log`, and `query --modified-file` already answers
that question for other purposes. Or a spec hand's failing test travelling
somewhere the suite does not reach until its dev hand arrives, which trades this
cost for a worse one and is probably wrong.

## Pre-flight reading

1. `scripts/verify.mjs` and `scripts/done-task.mjs` — where a contract is run
   and where the refusal is printed, which is where any attribution would land.
2. `scripts/query-tasks.mjs`, the `--modified-file` path — it already maps a
   file to the task that touched it, from the commit messages.
3. `backlog/history/TL-202.jsonl` and `backlog/history/TL-201.jsonl` — the two
   handoffs that produced the measurement above, with their timestamps.
4. `git show 4db2bc6 2ca784d` — the sibling spec commit and the finished task it
   blocked, in that order.

## Steps

1. Decide whether a wave shares a branch at all, and record the reason in
   Decisions either way — this settles whether the rest is needed.
2. If it does, make the refusal say which failures belong to the task being
   closed. Attribution by the commit that introduced the test file is the
   cheapest source and needs no new field.
3. Decide what a dev hand is supposed to DO when the only red is a sibling's:
   commit and stop, or park the task. Whatever it is, it belongs in
   `instructions autonomous-loop`, not only here.

## Acceptance criteria

- [ ] The suite and the guards are green. [proof: suite-green] [proof: guards-green]
- [ ] A dev hand refused by `done` can tell from the refusal alone whether the
      red suite is its own doing or a sibling's unimplemented spec.
      [proof: the-refusal-names-the-owner]
