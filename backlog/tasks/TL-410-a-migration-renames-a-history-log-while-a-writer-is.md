---
id: TL-410
title: "A migration renames a history log while a writer is appending to it"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: [TL-409]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: append-survives-a-rename
    bash: "node --test scripts/tests/migration-history-append-race.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

An event appended to `backlog/history/<ID>.jsonl` while `migrate-prefix` or
`renumber` is renaming that file ends up in the renamed log. Today nobody has
measured what happens to it, and the log is append-only, so whatever is lost is
lost permanently.

## Context

Surfaced by TL-228 on 2026-09-21, which put the snapshot read-modify-write of
both migrations inside one section (`scripts/snapshot-mutex.mjs`) and closed on
a race test that proves the migration's rename pass runs while that section is
held. That test deliberately sidesteps THIS question: it records the writer's
change BEFORE the migration starts, and its header says so.

The gap TL-228 left is one step further in. A migration renames every
`history/<ID>.jsonl` in the tree. `recordEdit()` opens a path and appends to it.
Between the two there is no shared exclusion — TL-228's section is scoped to the
snapshot (`"snapshot:" + realpath(dir)`), and deliberately so: the snapshot is
gitignored and per-worktree, and a repository-scoped key would make unrelated
trees wait. The log files are not per-worktree in that sense, so the narrower
key does not cover them.

The outcomes are not all equally bad and nobody has established which one
happens:

- the append lands in the OLD path, which the migration has already renamed —
  the event survives in a file no id points at any more, and the next read
  cannot see it;
- the append lands in the old path and the migration then renames it over the
  new one, or refuses to, depending on the order;
- the append lands in the NEW path because the rename won the race, which is the
  correct outcome and the one that makes this defect intermittent.

**Why this is worth its own task rather than a widening of TL-228.** That task's
recorded decision is that the section covers the three snapshot calls ONLY, and
that a concurrent writer WAITS — with the evidence that a section held across a
whole-tree rewrite can outlast `MUTEX_STALE_MS` (30 s), after which another
writer judges the holder dead and enters. Exclusion that reports itself and is
not there is worse than none. So the answer here cannot be "hold the existing
section for longer"; it needs its own mechanism and its own decision.

## Pre-flight reading

1. `scripts/snapshot-mutex.mjs` — the section TL-228 created and the reason for
   its scope, which this task must not simply widen.
2. `scripts/tests/migration-snapshot-race.test.mjs` — the race-test shape, and
   the header stating what it does not cover.
3. `scripts/history.mjs` — where `recordEdit()` opens the log and appends.
4. `scripts/migrate-prefix.mjs` and `scripts/renumber.mjs` — the rename pass over
   `history/`.

## Steps

1. Measure first. Build a race in which a writer appends while the rename pass
   is running, and record which of the outcomes above actually occurs, for both
   migrations. A fix designed against a guess about this is a guess.
2. Decide the mechanism and record it with `branchling decide`. The candidates:
   a migration marker that makes writers refuse for its duration (with an answer
   for the staleness problem TL-228 measured); a writer that re-resolves the path
   after acquiring exclusion; or a migration that renames the logs last and
   verifies nothing arrived meanwhile.
3. Whatever is chosen, an append that is accepted must be readable afterwards
   under the task's new id. Losing an event silently is the outcome this backlog
   exists to prevent.

## Acceptance criteria

- [ ] An event appended during a migration is readable under the new id
      afterwards, proven by a test that fails against today's code.
      [proof: append-survives-a-rename]
- [ ] The snapshot section TL-228 created keeps its scope and its decision.
      [proof: suite-green]
