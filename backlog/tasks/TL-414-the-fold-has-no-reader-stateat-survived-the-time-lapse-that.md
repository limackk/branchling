---
id: TL-414
title: "The fold has no reader: stateAt survived the time-lapse that used it"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: one-reader
    bash: "node --test scripts/tests/task-graph.test.mjs"
---

## Goal

`stateAt()` in `scripts/task-graph.mjs` is a fold over a task's history: it
answers what the task's fields were at a moment. Nothing in the tree calls it.
It was written for the board time-lapse (TL-91), and TL-379 removed the
time-lapse along with the rest of the viewer's write surface. `taskGraph()`,
the other export of that module, is what the page actually uses.

Decide whether the fold keeps its place or goes, and leave the reason in the
tree either way. Both answers are defensible and the task is not done while
the question is only implicit in a file nobody imports.

## Context

Surfaced while implementing TL-280, which decided what may SEED that fold and
extended it. The seeding decision stands on its own — it is a rule about what
the log records, and it is proved by tests — but TL-280's thesis was the rule,
not the module's right to exist, so this question could not be settled inside
it.

The two answers:

- **Keep it.** The module is pasted into the viewer by source (see the header
  of `task-graph.mjs`), it is covered by tests, and a replay over the history
  is a capability the backlog will plausibly want again. Then say so in the
  header: a reader who greps for a caller and finds none deserves to be told
  why there is none, rather than to discover it.
- **Remove it.** Law 2 says what is computed may be deleted, and an export with
  no caller is a promise the tree does not keep — dead code that every later
  reader has to re-establish is dead. Its tests go with it, and the decision
  in `backlog/history/TL-280.jsonl` remains the record of what the fold
  concluded.

Do not resurrect the time-lapse as a way of giving it a reader. TL-379 removed
that capability deliberately, and reinstating it needs its own argument.

## Pre-flight reading

1. `scripts/task-graph.mjs` — `stateAt()` and the header, which already names
   TL-91 and TL-379.
2. `scripts/tests/task-graph.test.mjs` — the section of TL-280 seed tests, the
   evidence that would be lost or kept.
3. `git show fa8e177` — TL-379, why the time-lapse and `board-replay.mjs` went.

## Steps

1. Decide, with `branchling decide`, before any edit.
2. Carry the decision out: either a header paragraph saying why the fold has no
   caller and is kept, or the removal of `stateAt()` and its tests.
3. Run the suite; `check` counts the product-name lines, so a removal moves it.

## Acceptance criteria

- [ ] The decision is in this task's history, not only in a diff.
      [proof: one-reader]
- [ ] Whichever way it goes, `grep -rn stateAt scripts` tells a consistent
      story: either no occurrences, or occurrences plus a header that says why
      nothing calls it. [proof: one-reader]
