---
id: TL-307
title: "Operational task comments do not become unanswered decisions"
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
related_docs: [scripts/resume-task.mjs]
verification:                      # HOW to check the task is really done
  - id: decision-classification
    bash: "node --test scripts/tests/resume-briefing.test.mjs scripts/tests/ask.test.mjs scripts/tests/decide.test.mjs"
---

## Goal

An operational `__comment__` written by `handoff` or `release` never appears as
an unanswered decision in a task briefing, and therefore cannot keep a task
blocked after its actual `ask` question has been answered.

## Context

While recording the accepted conformance-contract decision on TL-296, the
briefing parser treated an earlier handoff comment as a question solely because
it had a comment field. It reported one open question after the real question
was resolved. The recovery required a second `decide` write describing a
comment as not being a question, which is evidence of a classification defect,
not a user workflow.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/resume-task.mjs` — decision reconstruction and briefing rendering.
2. `scripts/ask-task.mjs` and `scripts/decide-task.mjs` — the event shape that
   uniquely identifies a question and its answer.
3. `scripts/handoff-task.mjs` — ordinary comments that must remain messages.

## Steps

1. Identify questions from the `ask` event shape, not from all comment events.
2. Preserve the rendered history of operational comments.
3. Add positive controls for an answered question and an unresolved question,
   plus a negative control for a handoff/release comment.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] A resolved question no longer blocks the task when unrelated operational
  comments exist in its history. [proof: decision-classification]
- [ ] An actual unanswered `ask` event still remains visible and blocks its
  task. [proof: decision-classification]
