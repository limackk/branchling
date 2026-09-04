---
id: TL-255
title: "A chosen option that cannot be a reason is refused for the cause that fired"
type: code
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m                      # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: one-cause-not-three
    bash: "grep -c 'longer than 500 characters' scripts/decide-task.mjs | grep -qx 0 && echo 'the refusal no longer enumerates every rule — OK'"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs > /dev/null"
---

## Goal

`decide --choose <n>` refuses an option it cannot record as a reason with the
cause that actually fired, not with a list of all three, and it takes the limit
from `REASON_MAX_LENGTH` rather than from a literal `500`.

## Context

TL-167 moved the diagnosis of an unusable reason into one place:
`reasonRefusal(value, flag)` in `scripts/task-fields.mjs` returns the sentence
explaining WHICH of the three rules a value breaks — it is empty, it is one of
the two reserved sentinels, or it is longer than `REASON_MAX_LENGTH` — or null
when it breaks none. Seven call sites now print what it returns.

One site was left behind on purpose, because it is not the same shape and
TL-167 did not name it: `scripts/decide-task.mjs`, in the `--choose` branch that
reads an option out of the log. Its message is

    "It is empty, longer than 500 characters, or one of the two words the tool",
    "reserves for itself. Answer with `--reason \"…\"` instead.",

which is honest — it enumerates every rule rather than naming the wrong one —
but it is still the reader's job to work out which of the three applies, and it
is the last place in `scripts/` where the length limit is a literal instead of
`REASON_MAX_LENGTH`. Change the constant and this sentence starts lying.

The value here does NOT come from a flag somebody just typed: it comes from an
option recorded in `backlog/history/`, which can only hold an unusable one if
the log was edited by hand. That is why the site keeps the boolean today and why
it is a separate decision from TL-167 — the refusal has to keep saying which
option, of which question, could not be recorded.

## Pre-flight reading

1. `scripts/task-fields.mjs` — `reasonRefusal`, `reasonCause` and the comment
   above them explaining why the cause is decided there.
2. `scripts/decide-task.mjs` — the `unusable-option` branch, its `message` and
   its `details`. Note that this route returns a result object rather than
   throwing, so the refusal is assembled differently from the seven sites.
3. `scripts/tests/change-reason.test.mjs` — the table of sites and the three
   assertions each one carries, as the model for whatever is asserted here.

## Steps

1. Point the `unusable-option` branch at `reasonRefusal`, keeping the `message`
   naming the option number and the question it belongs to.
2. Remove the `500` literal.
3. Assert the three causes, each naming itself and no other.

## Acceptance criteria

- [ ] An option refused by `decide --choose` is refused for the one rule it
      breaks, and the length limit is read from `REASON_MAX_LENGTH`. [proof: one-cause-not-three]
- [ ] Nothing else in the suite changes. [proof: suite]
