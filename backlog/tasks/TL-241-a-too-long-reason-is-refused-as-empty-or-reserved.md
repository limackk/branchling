---
id: TL-241
title: "A too-long reason is refused as \"empty or reserved\""
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-name                   # optional; a criterion below points at this id
    bash: "command to run"
---

## Goal

A `--reason` longer than `REASON_MAX_LENGTH` is refused with a message that
names the length, and says what the limit is. It is currently refused as
"empty or reserved", which it is not.

## Context

Measured on 2026-09-04 while recording the Step 1 decision of TL-201:

    $ branchling decide TL-201 --actor agent:dev --reason "<560 characters>"
    branchling decide: `--reason <the whole text>` is empty or reserved
      `unknown` and `proven` are what the tool writes when nobody stated a reason;
      typing one by hand would dress a machine's answer up as yours.

The reason was neither empty nor a sentinel. `isValidReason()` in
`scripts/task-fields.mjs` folds three different rejections into one boolean —
not a string, a reserved sentinel, empty after trimming, and longer than
`REASON_MAX_LENGTH` (500) — and the three call sites each print the sentinel
explanation for all of them. So the author reads an accusation that does not
apply, is told nothing about the limit or how far over it they are, and the
obvious next move is to retype the same sentence rather than to shorten it.

The message is also the wrong length to be read: it echoes the entire rejected
reason back, which for a long one buries the diagnosis.

## Pre-flight reading

1. `scripts/task-fields.mjs` — `isValidReason()`, `REASON_MAX_LENGTH`,
   `REASON_SENTINELS`.
2. The three call sites that print the message: `scripts/decide-task.mjs`,
   `scripts/handoff-task.mjs`, `scripts/ask-task.mjs` (the last one for
   `--question`, which has the same shape).

## Steps

1. Give the validation a reason of its own — a function that returns WHICH rule
   was broken, not a boolean — and keep `isValidReason()` for the callers that
   only need yes or no.
2. Print the length and the limit when that is the rule that failed, and stop
   echoing a long reason back in full.
3. One test per rule, so that the three cases cannot collapse back into one.

## Acceptance

- [ ] A reason over the limit is refused with a message that says so and names
      both the actual length and the limit.
- [ ] A sentinel reason still gets the sentinel explanation, unchanged.
- [ ] An empty reason still gets the empty explanation.
- [ ] `node --test scripts/tests/*.test.mjs` and `branchling check` are green.
