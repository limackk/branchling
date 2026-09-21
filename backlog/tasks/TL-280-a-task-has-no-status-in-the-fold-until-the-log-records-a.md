---
id: TL-280
title: "A task has no status in the fold until the log records a change"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - docs/backlog-field-editing-history.md
# Contract rewritten before the work, under TL-260, which measured this block
# as one that could not fail. It was worse than unfalsifiable: it named
# `scripts/tests/board-replay.test.mjs`, deleted with the board time-lapse by
# TL-379, so the run could only ever fail on a MISSING FILE and never on a
# missing behaviour — neither state told anyone anything about the fold.
# `fold-seed` now names the fold's own suite, whose seven TL-280 tests failed
# against the code as it stood (24 pass, 5 fail on 2026-09-21; the two that
# passed are the positive controls against over-seeding). `decision` proves the
# deliverable the task calls the real one, and `suite` keeps a whole-tree run.
verification:
  - id: fold-seed
    bash: "node --test scripts/tests/task-graph.test.mjs"
  - id: decision
    bash: "grep -q '\"field\":\"__decision__\"' backlog/history/TL-280.jsonl"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`stateAt()` in `scripts/task-graph.mjs` folds a task's history into the fields
it had at a moment, and `boardAt()` in `scripts/board-replay.mjs` arranges that
into a board. Both start from NOTHING: the log records a CHANGE, so a field
that has never been changed since the log began has no entry, and the fold
answers "the log does not say".

Measured against this repository on 2026-09-05, at the latest moment the log
covers: 279 tasks on the board, 107 of them in the `STATUS_UNKNOWN` bucket.
That is 38% of every frame, including today's, sitting in a column that says
nothing — and it is the honest answer to the question as the fold currently
asks it, not a defect in the fold.

The question to decide: may the fold be SEEDED, and from what?

## Context

Came out of TL-91 (the board time-lapse), which is where the number above was
measured. TL-91 deliberately did not decide this: its thesis is that a moment
the log cannot speak about must be marked as such rather than drawn as an empty
board, and inventing a starting status would have contradicted exactly that.

The obvious seed is the task file's CURRENT frontmatter, walked backwards. It
is also the trap: today's `status: done` says nothing about 2026-08-30, and a
frame that carried it back would state as fact something nobody recorded — the
same defect TL-91 exists to rule out, moved one layer down. A backward walk is
only sound for a field the log has an entry for; before the FIRST entry of a
field there is no `from` to reach.

What may be sound, and needs deciding rather than assuming:

- The first entry of a field carries `from` — the value BEFORE that change.
  That is a recorded fact, not a guess, and it extends a field's known past
  back to the beginning of the log (though never before it).
- `__created__` is a recorded fact too: a task created inside the log's range
  had whatever `new` wrote, and the template's default status is knowable.
- Neither of those helps a task that existed before the log began and was never
  touched since. That one may have to stay unknown for good — which is the
  right answer if it is, and a reason to say so in the viewer rather than to
  paper over it.

Also worth weighing: whether a seeded fold makes `STATUS_UNKNOWN` rare enough
that the bucket stops carrying its meaning. A column holding 38% of the board
is read as "a category"; one holding three tasks is read as "these three are
not known", which is what it means.

## Pre-flight reading

1. `scripts/task-graph.mjs` — `stateAt()`, the fold both readers share, and the
   four rules in its header (rule 4 is the one this task pushes on).
2. `scripts/board-replay.mjs` — `boardAt()` and `STATUS_UNKNOWN`; the bucket is
   a named export precisely so a decision like this has one place to change.
3. `docs/backlog-field-editing-history.md` §2 and §6 — the entry format
   (`from`/`to`, the pseudo-fields) and the reasoning that already refused a
   git backfill once, which any seed has to answer.

## Steps

1. Decide what may seed the fold, and record the decision with
   `branchling decide` before writing code — the reasoning is the deliverable
   here, the diff is small.
2. If a seed is adopted: extend `stateAt()` (not a second fold) and say in its
   header which facts are recorded and which are refused.
3. Fixtures for each case: a field whose first entry carries a `from`, a task
   created inside the log, and a task that existed before the log and was never
   touched — the last must stay unknown.
4. Re-measure the bucket against this repository and put the number in the
   commit body, the way TL-91 did.

## Decision

Recorded in `backlog/history/TL-280.jsonl` on 2026-09-21, before the code.

**Adopted, and it is the only seed.** The EARLIEST entry for a field carries
`from` — the value the field held before that change. That is a recorded fact,
so it holds backwards from the change to the first entry the task's log has,
and no further. A `from` that is an empty string or an empty list seeds
nothing: "the field was blank" and "nothing about it was recorded" are
indistinguishable in that byte, and telling those two apart is the fold's whole
contract.

**Refused: today's frontmatter, walked backwards.** Today's `status: done` says
nothing about the day the log begins, and a frame carrying it back would state
as fact something nobody recorded — the defect TL-91 exists to rule out, moved
one layer down.

**Refused: the template's default status at `__created__`.** The default is
read from TODAY's configuration and template rather than from what `new` wrote
then, so it is the same invention wearing a different hat.
`docs/backlog-field-editing-history.md` §6 refused a git backfill on the same
ground, and this seed would have to answer that refusal without being able to.

**Kept, deliberately.** A task that existed before its log began and was never
touched since still has no status in the fold. The seed narrows that case; only
an invention could remove it.

## What this task's own text predates

`scripts/board-replay.mjs`, `boardAt()` and the `STATUS_UNKNOWN` bucket were
deleted with the board time-lapse by TL-379, so the 107-of-279 measurement has
no reader left to re-measure and the bucket's name appears nowhere in the tree.
The seed therefore lands in `stateAt()` alone — which was always the task's
instruction ("extend `stateAt()`, not a second fold") — and the bucket is
measured directly over `backlog/history/` instead. The time-lapse is not
rebuilt here: resurrecting a capability another task deliberately removed is
not this task's thesis.

## Acceptance criteria

- [x] The decision is recorded in `backlog/history/TL-280.jsonl`, not only in
      the code. [proof: decision]
- [x] A task whose past the log genuinely does not record still folds to
      unknown — the seed does not remove the case, it narrows it.
      [proof: fold-seed]
- [x] A value the fold did not replay but inferred from a later entry's `from`
      is NAMED as seeded, so no reader can pass it off as a recorded change.
      [proof: fold-seed]
- [x] One fold: `stateAt()` is still the only replay of the history, and the
      whole suite agrees. [proof: suite]
