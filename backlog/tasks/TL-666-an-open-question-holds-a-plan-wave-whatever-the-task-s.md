---
id: TL-666
title: "An open question holds a plan wave whatever the task's status"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-09
updated: 2026-11-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: plan-held-open-question
    bash: "node --test scripts/tests/plan-held-wave.test.mjs"
---

## Goal

`unattendedHold` in scripts/plan.mjs counts an open question as a hold whatever the task's status, so `plan` calls a wave held exactly where `run --dry-run --plan` stops when a task carrying an unanswered question sits outside a protected status.

## Context

TL-645 added `unattendedHold`. It reads `openQuestions(history)` only for a status in `reason_required_statuses` (the `protected-status` kind). `next` refuses any task with an open question (`isExecutable` in scripts/next-task.mjs), whatever its status, and the run's projection therefore does not count such a task as reachable. Two records slip between the two readers: a claim old enough to reclaim (`abandoned_after_days`), which `unattendedHold` returns as no hold, and a `pending` task whose question was asked and whose status was then set back by hand. If such a task is the only other open task of its wave, `run --dry-run --plan` stops at that wave while `plan` does not print it as held, and the empty next-up line blames a blocker. `ask` normally moves a task into a protected status, so the case needs a status written outside `ask`; it was named by the TL-645 implementer and not fixed there.

## Steps

1. In scripts/plan.mjs, make an open question a hold (not startable) before the status branches, with a `describeHold` sentence naming the question; keep `protected-status` for a protected status without one.
2. Test in scripts/tests/plan-held-wave.test.mjs: a wave whose only open task is a reclaimable claim with an open question, and one whose only open task is `pending` with an open question, are each held in `plan --json` and stop `run --dry-run --plan` at that wave with the same sentence; a positive control with the question decided is not held.

## Acceptance criteria

- [ ] an open question holds a wave in plan wherever it holds the run, whatever the status [proof: plan-held-open-question]
