---
id: TL-407
title: "A history write failure leaves take frontmatter changed"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/take-task.mjs, scripts/handoff-task.mjs, scripts/done-task.mjs]
verification:                      # HOW to check the task is really done
  - id: take-is-atomic
    bash: "node --test scripts/tests/take-atomicity.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`take` writes the task file and its history as one transaction: a history write
that fails leaves the frontmatter exactly as it was.

## Context

TL-351 fixed this for `handoff`. `takeTask()` in `scripts/take-task.mjs` still
has the original order: `writeFileSync(file, text)` at line 258 and
`recordEdit()` at line 269, with nothing between them that undoes the first when
the second throws. Every failure mode TL-351 named applies unchanged — the mutex
directory cannot be created, another process holds the section past the wait, the
history directory is not there — and each of them leaves a task saying
`in_progress` with an owner while no event records the claim. The next
`reconcile` then attributes that change to `unknown`, because nobody was left to
ask.

`done` is NOT in this state: `scripts/done-task.mjs` line 875 already writes the
original text back when `recordEdit()` throws. So this task is about `take`, and
about deciding whether the two commands should share one helper rather than
carry two spellings of the same rule.

## Pre-flight reading

1. `scripts/take-task.mjs` — the write and record order in `takeTask()`.
2. `scripts/handoff-task.mjs` — `stageTaskText`/`commitStaged`/`discardStaged`
   and the comment explaining why the append-only half goes second-to-last.
3. `scripts/tests/handoff-atomicity.test.mjs` — the fixture that forces a history
   failure without depending on the machine's permissions.

## Steps

1. Add `scripts/tests/take-atomicity.test.mjs` with the same forced failure, a
   retry and a positive control.
2. Make the task-file and history writes of `take` one observable transaction.
3. Decide whether the staging helpers move to a shared module; if they do, bring
   `handoff` and `done` onto it in the same change.

## Acceptance criteria

- [ ] A failed history write makes `take` exit non-zero with the task file at its
  pre-command value and no partial history. [proof: take-is-atomic]
- [ ] Retrying after the failure records the complete claim without a manual
  repair. [proof: take-is-atomic]
- [ ] A successful `take` still writes matching status and owner events beside the
  frontmatter change. [proof: take-is-atomic]
- [ ] The complete automated test suite remains green. [proof: suite-green]
