---
id: TL-312
title: "Decision panel fixtures identify ask events explicitly"
type: task
labels: []
board: main
epic: "Execution observability"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/tests/decision-panel.test.mjs, scripts/task-fields.mjs]
verification:                      # HOW to check the task is really done
  - id: ask-fixtures
    bash: "node --test scripts/tests/decision-panel.test.mjs scripts/tests/ask-options.test.mjs"
---

## Goal

Fixtures that represent questions carry `source: ask`, so the decision panel
continues to exercise actual unanswered questions after TL-307 separated them
from operational comments.

## Context

TL-307 made `source: ask` the sole definition of a question. The decision-panel
fixture still created generic comments, which the new classifier correctly
excludes. This is a test-data migration, not a reason to loosen the shared
classifier or reclassify handoffs.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/tests/decision-panel.test.mjs` — shared question fixture and its
   panel assertions.
2. `scripts/task-fields.mjs` — `isQuestion()` definition the fixture must name.

## Steps

1. Mark synthetic question comments with `source: ask`.
2. Preserve the tests' operational-comment negative control.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] The panel includes actual ask events and excludes operational comments.
  [proof: ask-fixtures]
