---
id: TL-186
title: "run --plan reports the queue as empty when the plan is merely waiting"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:sub-b
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: ["docs/manual.md"]   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: plan-order
    bash: "node --test scripts/tests/plan-order.test.mjs"
---

## Goal

`run --plan` says why it stopped. Today it prints `stopped: the queue is empty`
whenever `next` answers exit 3, and under `--plan` that sentence is false in the
two cases that matter most: the plan's active wave is entirely in flight in
another session, and the backlog still holds open work the plan does not
schedule. The run report is then a statement about the backlog that is not true
of the backlog.

## Context

Measured on 2026-09-03 while TL-183 added `--plan`. `next --plan` already
answers with everything needed: since TL-183 the `task-take` envelope carries a
`plan` object with `wave`, `name`, `scheduled`, `open` and `skippedUnplanned`,
and the empty-queue answer carries it too. The loop reads that JSON already —
`run-loop.mjs` parses it for the task it was handed — but on exit 3 it breaks
out of the loop without looking at the payload at all.

This is a REPORT defect, not a dispatch one: the order `--plan` hands out is
correct, and TL-183's tests prove it. What is missing is the sentence at the
end, and the same class of defect as TL-184 — a run whose report cannot be
believed is not worth pointing at a plan.

**A wave in flight is not a finished plan.** A fleet running `run --plan` in
several worktrees will hit this on every wave that has fewer tasks than workers:
each extra worker gets exit 3 immediately and reports an empty queue, while the
wave is being worked next door. That reading is what makes a person conclude the
plan is done.

**What this is NOT.** It is not `run` waiting for the wave to finish, and not a
retry loop. Ending the run is right — the tool has no work for this session.
Only the sentence is wrong.

## Pre-flight reading

1. `scripts/run-loop.mjs` — `stopped` is set to `"the queue is empty"` before the
   loop and never revised on the exit-3 path; `renderReport` prints it.
2. `scripts/next-task.mjs` — the empty-queue JSON branch, and the `planJson`
   object it emits.
3. `scripts/json-envelope.mjs` — the `task-take` shape, where `plan` is declared.

## Steps

1. On exit 3 under `--plan`, read the `plan` object out of `next`'s JSON answer
   and set `stopped` from it: the wave that is still open and how many of its
   tasks are in flight, or that every wave of the plan is finished.
2. Say when open work was left alone because the plan does not schedule it —
   `skippedUnplanned` — so a reader is never told the backlog is empty when it
   is not.
3. Without `--plan` the sentence stays exactly as it is today.
4. Tests in `scripts/tests/plan-order.test.mjs`, on a FIXTURE tree: one where
   the active wave is claimed by another actor, one where the plan is finished
   and unplanned work remains, and a control that the unflagged run still says
   `the queue is empty`.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A `--plan` run that stops on a wave somebody else is working says so, and
      does not call the queue empty. [proof: plan-order]
- [x] A `--plan` run that stops with unplanned open work left says how much was
      left alone. [proof: plan-order]
- [x] Without `--plan` the report is byte for byte what it was. [proof: suite-green]
