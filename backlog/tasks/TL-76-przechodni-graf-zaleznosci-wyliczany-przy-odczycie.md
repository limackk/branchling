---
id: TL-76
title: "Transitive dependency graph computed at read time"
type: code
labels: [post-launch]
board: main
epic: "Data integrity"
priority: P3
status: pending
owner: unassigned
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test scripts/tests/dependency-graph.test.mjs"
  - bash: "node scripts/cli.mjs query --graph TL-74"
---

## Goal

A task's detail view shows the full, transitive dependency context: what this
task is waiting on (directly and further out) and what it unblocks. The graph
is computed at read time and does not land in any file.

## Context

We have `blocked_by` and `blocks` as flat lists of IDs, and the
`check-backlog-refs.mjs` guard, which ensures they point at existing tasks.
Transitivity is missing: "TL-80 waits on TL-72, and TL-72 waits on TL-68" has
to be assembled by hand today, opening one file after another.

The graph is computed, never written — law II. A written graph would sooner
or later become a source of truth and drift from the lists it is built from.

Four edge cases that must be handled explicitly (taken from Backlog.md's
model, because these are exactly the places where a naive implementation
lies):

1. **Edge direction.** The edge goes from the task declaring the dependency to
   the task it depends on. The pointed-at task blocks the pointing one.
2. **Cycle** — marked `(cycle)`, not expanded infinitely.
3. **Repetition** — a task is shown once; a later occurrence is marked
   `(above)`.
4. **Unresolved identity** — `unknown ID` (nobody claims it) and `ambiguous
   ID` (more than one claims it). NEITHER counts as satisfied and the graph
   does NOT traverse through them. A wrong graph that reports "unblocked" is
   worse than no graph.

## Pre-flight reading

1. `scripts/check-backlog-refs.mjs:66-114` — `REF_FIELDS`, `auditRefs()`. Half
   the logic already lives here: reading the fields and resolving whether an
   ID exists.
2. `scripts/query.mjs` — where to hook in the text and JSON output.
3. `_template.md` — the semantics of `blocked_by` and `blocks` in the
   template.

## Steps

1. Extract ID resolution (exists / unknown / ambiguous) from
   `check-backlog-refs.mjs` into a module used by both the guard and the
   graph.
2. `scripts/dependency-graph.mjs` — build the graph from the root in both
   directions, handling cycles, repetition, and unresolved IDs.
3. Text output: a tree with a header `N direct, M total`.
4. JSON output: `root`, `nodes`, `edges`; each node carries its depth in both
   directions (`null` when unreachable in a given direction).
5. The same graph in the task detail view in the viewer.
6. `scripts/tests/dependency-graph.test.mjs` — a fixture for each of the four
   edge cases. Especially: an ambiguous ID is NOT satisfied.

## Acceptance criteria

- [ ] The graph shows transitive dependencies in both directions, with direct
      ones distinguished.
- [ ] Cycles and repetitions are marked, not expanded.
- [ ] Unknown and ambiguous IDs never count as satisfied and are never
      traversed.
- [ ] The graph is never written to any task file.
- [ ] The test has a separate fixture for each of the four edge cases.

## Log

2026-08-31 pending — agent:claude — created from the Backlog.md analysis (github.com/MrLesk/Backlog.md), point 4.
2026-09-01 pending — agent:claude — lowered P2→P3 from the competitive analysis — feature parity with the leader is not a reason to migrate; the graph can wait behind the verification mechanism and launch.
