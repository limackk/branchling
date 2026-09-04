---
id: TL-244
title: "Most estimates in this tree sit outside the estimates vocabulary"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: every-open-estimate-has-a-position
    manual: "`branchling query --status pending,in_progress,blocked --json` reports no `estimate` outside the `estimates:` list in config.yaml"
---

## Goal

Every open task in this backlog carries an estimate the `estimates` vocabulary
actually contains, so the size gate TL-211 built can see it.

## Context

TL-211 gates what an unattended run may be handed on the POSITION of a task's
estimate in `estimates: [30m, 2h, 1d, 1w]`. A word the list does not contain has
no position, so it is never gated — deliberately, because inventing an order for
an unknown word is exactly what the design refuses.

Measured in this tree on 2026-09-04, while TL-211 was being written:

    61 + 30 + 15 tasks   2h      in the vocabulary
    38 + 1 + 6 tasks     1d      in the vocabulary
    49 + 1 + 3 tasks     4h      NOT in the vocabulary
    11 tasks             3h      NOT in the vocabulary
    5 + 2 tasks          1h      NOT in the vocabulary

So roughly one task in four is invisible to the gate, and `4h` — the most common
of the three — is between `2h` and `1d`, which is to say the gate would have
something to say about it if the word had a place in the list.

The vocabulary is FREE by design (`init-backlog.mjs` writes `# [free]
suggestions in the viewer` beside it), so an estimate outside the list is not a
validation failure and `check` correctly says nothing. That is the point: this
is a DATA question about this backlog, not a defect in the tool.

## Pre-flight reading

1. `scripts/next-task.mjs` — `isOverSized()`, and the comment about why an
   unknown estimate is not gated.
2. `backlog/config.yaml` — `estimates:` and `max_unattended_estimate:`.
3. `scripts/calibration.mjs` — the estimates are also the input to the
   calibration report, so a rewritten value changes what that reports.

## Steps

1. Decide the direction: either add `1h`, `3h` and `4h` to `estimates` (keeping
   the list ordered, which is what the gate reads), or rewrite the tasks onto
   the four words already declared. The two answers are not equivalent — a
   longer list makes the threshold finer, a rewrite loses information.
2. Apply it to the OPEN tasks at least; closed ones are history and a rewrite
   there changes what `calibration` reports about work already done.
3. Say in the commit which of the two was chosen and why.

## Acceptance criteria

- [ ] Every open task's `estimate` has a position in `estimates`, so the size
      gate can answer about it. [proof: every-open-estimate-has-a-position]
