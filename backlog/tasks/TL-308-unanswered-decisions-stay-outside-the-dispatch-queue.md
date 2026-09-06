---
id: TL-308
title: "Unanswered decisions stay outside the dispatch queue"
type: task
labels: []
board: main
epic: "Execution observability"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/next-task.mjs, scripts/plan.mjs]
verification:                      # HOW to check the task is really done
  - id: question-protection
    bash: "node --test scripts/tests/next.test.mjs scripts/tests/plan-command.test.mjs scripts/tests/ask.test.mjs"
---

## Goal

A task awaiting a decision is never selected by `next` or included in an
executable plan, even when its ordinary `blocked_by` dependencies are all
closed. A real answer makes it eligible again through the existing decision
flow, without manual queue repair.

## Context

While restoring TL-296 after its conformance-contract decision, `next --plan`
selected the task from `blocked` once its `blocked_by` list no longer held an
open task. The unresolved-decision state lives in history rather than in
`blocked_by`, so queue selection cannot treat a generic blocked task with
closed dependencies as executable without first checking its recorded open
questions. This is separate from TL-307: that task classifies question events;
this task protects a correctly classified unanswered question in dispatch.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/next-task.mjs` — candidate and reclaim selection for blocked work.
2. `scripts/plan.mjs` — the planning path that must share the same rule.
3. `scripts/ask-task.mjs` and `scripts/decide-task.mjs` — lifecycle and history
   representation of a question block.

## Steps

1. Derive unresolved-decision eligibility from the history using the shared
   question classifier.
2. Exclude an unresolved decision from both direct dispatch and executable plan
   selection, including the path that reopens an otherwise unblocked task.
3. Preserve normal dependency unblocking and eligibility after `decide`.
4. Add fixtures that distinguish a dependency block from an unanswered decision.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] `next` does not claim a task with an unanswered question solely because
  its `blocked_by` entries have closed. [proof: question-protection]
- [ ] An executable plan omits that task until the question is answered, while
  an ordinary dependency-unblocked task remains eligible. [proof: question-protection]
- [ ] Deciding the recorded question restores the task to normal queue
  eligibility. [proof: question-protection]
