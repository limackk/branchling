---
id: TL-311
title: "Task graphs classify operational comments as messages"
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
related_docs: [scripts/task-graph.mjs, scripts/task-fields.mjs]
verification:                      # HOW to check the task is really done
  - id: graph-comment-kinds
    bash: "node --test scripts/tests/task-graph.test.mjs scripts/tests/decide.test.mjs"
---

## Goal

The history graph renders `ask` events as questions and renders `handoff`,
`release` and other operational comments as messages, so its visual state uses
the same event classification as the decision and briefing paths.

## Context

TL-307 corrected `openQuestions()` to identify questions by `source: ask`.
`scripts/task-graph.mjs` still assigns the `question` node kind to every
`__comment__`, which can visually mark a handoff note as unanswered work even
though it cannot block a task. This is a separate renderer concern and must not
reintroduce a second definition of question state.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/task-graph.mjs` — node classification, links and open-node state.
2. `scripts/task-fields.mjs` — the shared `isQuestion()` classifier from TL-307.
3. `scripts/tests/task-graph.test.mjs` — graph positive and negative controls.

## Steps

1. Reuse the shared question classifier when choosing graph node kinds and
   links.
2. Keep operational comments visible as history rather than silently dropping
   them from the graph.
3. Add fixtures that distinguish an `ask` comment from a handoff/release
   comment in the same timeline.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] An `ask` event remains a question node and links to its decision.
  [proof: graph-comment-kinds]
- [ ] Operational comments remain visible but cannot be labelled or linked as
  open questions. [proof: graph-comment-kinds]
