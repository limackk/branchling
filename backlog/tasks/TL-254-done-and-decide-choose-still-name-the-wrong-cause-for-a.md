---
id: TL-254
title: "done and decide --choose still name the wrong cause for a reason"
type: code
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: [TL-167]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: no-refusal-names-the-wrong-cause
    bash: "node --test scripts/tests/change-reason.test.mjs"
  - id: the-limit-is-not-typed-in-prose
    bash: "test $(grep -c '500 characters' scripts/*.mjs | grep -v ':0$' | wc -l) -eq 0 && echo 'the limit is read from the constant — OK'"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs > /dev/null"
---

## Goal

Every refusal of an unusable reason names the cause it actually had. TL-167
does this for the six call sites that print "is empty or reserved"; two more
refusal paths say the wrong thing and are not covered by its guard.

## Context

TL-167 replaced the shared "empty or reserved" sentence with a diagnosis that
names one of three causes: the value is empty, it is one of the two reserved
words, or it is longer than `REASON_MAX_LENGTH`. Its `one-diagnosis-not-six`
check greps for the literal `is empty or reserved`, so two paths phrased
differently stay wrong while that guard reads green.

Measured on this tree, before TL-167 was implemented:

1. `scripts/done-task.mjs`, in the `--reason` branch of the argument parser.
   A 600-character reason is refused with "`--reason <the whole 600
   characters>` is reserved", followed by two lines about `unknown` and
   `proven`. The value is not reserved, the whole of it is echoed back, and
   the length that would explain the refusal is missing. The same defect as
   TL-167, in different words.

2. `scripts/decide-task.mjs`, the `unusable-option` refusal on the `--choose`
   path. It lists all three causes at once — "It is empty, longer than 500
   characters, or one of the two words the tool reserves for itself" — so the
   reader still has to work out which one applies. It also types `500` into
   prose, where `REASON_MAX_LENGTH` is the only place that number belongs; a
   change to the constant would leave the sentence saying something false.
   This path is reached only from a log edited by hand, which is why TL-167
   left it alone.

`scripts/ask-task.mjs` carries the same typed-in `500`, but on a line TL-167
rewrites, so it is not this task's business.

Not in scope: the `needs-reason` refusal in `scripts/take-task.mjs`. That one
is about a reason that was never given at all, not about a wrong cause being
named, and its message is already right.

## Pre-flight reading

1. `scripts/task-fields.mjs` — the diagnosing function TL-167 adds beside
   `isValidReason`, and `REASON_MAX_LENGTH`.
2. `scripts/done-task.mjs` — the `--reason` branch of the parser.
3. `scripts/decide-task.mjs` — the `unusable-option` return on the `--choose`
   path.
4. `scripts/tests/change-reason.test.mjs` — the `REASON_SITES` table TL-167
   adds; these two paths are new entries in it, not a new file.

## Steps

1. Add both paths to `REASON_SITES` in `scripts/tests/change-reason.test.mjs`
   and watch them fail. `decide --choose` needs an open question with a
   recorded option, so it may need a fixture of its own rather than a row in
   the table.
2. Point both refusals at the diagnosing function TL-167 introduced.
3. Delete the two typed-in `500`s; the number comes from the constant.

## Acceptance criteria

- [ ] A reason over the limit passed to `done` is refused with its length and
      the limit, and is not called reserved. [proof: no-refusal-names-the-wrong-cause]
- [ ] `decide --choose` on an option it cannot record names the one cause that
      applies. [proof: no-refusal-names-the-wrong-cause]
- [ ] No message types the limit into prose. [proof: the-limit-is-not-typed-in-prose]
- [ ] Nothing else in the suite changes. [proof: suite]

## Notes

- Surfaced while writing TL-167's failing test. It was kept out of that task
  deliberately: TL-167 enumerates six call sites and its guard greps for one
  phrase, so widening it there would have blurred a task already in flight.
