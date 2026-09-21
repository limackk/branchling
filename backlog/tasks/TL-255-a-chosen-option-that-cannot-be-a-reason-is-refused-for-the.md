---
id: TL-255
title: "A chosen option that cannot be a reason is refused for the cause that fired"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m                      # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  # REWRITTEN BEFORE THE WORK STARTED. The old first entry grepped
  # scripts/decide-task.mjs for the sentence this task deletes. It did fail
  # against the tree as it stood, but it is green for any change that DELETES
  # the diagnosis — a branch that refused with no explanation at all would
  # satisfy it — and it says nothing about which of the three causes is named
  # or about the limit coming from `REASON_MAX_LENGTH`. Both halves of the one
  # acceptance criterion it was asked to prove were therefore unproven. The
  # first entry is now the test that asserts each cause names itself and no
  # other, and it failed 3 of 52 against the unchanged code; the literal gets
  # a proof of its own, and the suite keeps second place.
  - id: one-cause-not-three
    bash: "node --test scripts/tests/change-reason.test.mjs > /dev/null"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs > /dev/null"
  # NO BACKSLASH IN THIS PATTERN. `\b` written here survives into the shell as
  # two characters, so the word-boundary form matched nothing and the negation
  # was green against the literal it was written to catch. The character class
  # says the same thing and needs no escape; checked against the pre-change
  # file, which it fails.
  - id: no-literal-limit
    bash: "! grep -qE '(^|[^0-9])500([^0-9]|$)' scripts/decide-task.mjs"
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

- [x] An option refused by `decide --choose` is refused for the one rule it
      breaks — each cause naming itself and no other. [proof: one-cause-not-three]
- [x] The length in that refusal is read from `REASON_MAX_LENGTH`: no `500` is
      written out in `scripts/decide-task.mjs`. [proof: no-literal-limit]
- [x] Nothing else in the suite changes. [proof: suite]
